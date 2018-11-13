"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.SnapTool = void 0;

var _glob = require("glob");

var _minimist = _interopRequireDefault(require("minimist"));

var _version = require("./version");

var _toposort = _interopRequireDefault(require("toposort"));

var _fsExtra = require("fs-extra");

var _path = _interopRequireDefault(require("path"));

var _process = _interopRequireDefault(require("process"));

var _child_process = require("child_process");

var _tmp = _interopRequireDefault(require("tmp"));

var _commandExists = require("command-exists");

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class SnapTool {
  constructor(toolName, log) {
    this.toolName = toolName;
    this.log = log;
  }

  ensureCommands(cmds) {
    this.cmds = this.cmds || new Set();
    cmds.forEach(cmd => {
      if (!this.cmds.has(cmd) && !(0, _commandExists.sync)(cmd)) {
        throw new Error(`Command '${cmd}' does not exist.  Please install it.`);
      } else {
        this.cmds.add(cmd);
      }
    });
  }

  async getPackageInfo() {
    if (!(await (0, _fsExtra.exists)("package.json"))) {
      throw new Error("The current directory does not contain a package.json file");
    }

    const filenames = (0, _glob.sync)("**/package.json", {
      ignore: ["**/node_modules/**", "**/scratch/**"],
      realpath: true
    });
    const dirNames = filenames.map(filename => _path.default.dirname(filename));
    const pkgMap = new Map(dirNames.map(dirName => [dirName, {}]));
    let edges = [];
    let rootPkg = null;

    for (let pair of pkgMap) {
      const [dirName, pkg] = pair;
      const packageFilename = dirName + "/package.json";
      let content = null;

      try {
        content = JSON.parse((await (0, _fsExtra.readFile)(packageFilename, {
          encoding: "utf8"
        })));
      } catch (error) {
        this.log.error(`Reading ${packageFilename}`);
        throw error;
      }

      pkg.content = content;

      if (dirName === _process.default.cwd()) {
        rootPkg = pkg;
      } else if (content.dependencies) {
        const prefix = "file:";
        Object.entries(content.dependencies).forEach(arr => {
          if (arr[1].startsWith(prefix)) {
            const otherdirName = _path.default.resolve(_path.default.join(dirName, arr[1].substring(prefix.length)));

            if (pkgMap.has(otherdirName)) {
              edges.push([dirName, otherdirName]);
            }
          }
        });
      }
    }

    return {
      pkgs: pkgMap,
      order: _toposort.default.array(dirNames, edges).reverse(),
      rootPkg
    };
  }

  execWithOutput(command, options) {
    return new Promise((resolve, reject) => {
      const cp = (0, _child_process.exec)(command, options);
      const re = new RegExp(/\n$/);
      cp.stdout.on("data", data => {
        const s = data.toString().replace(re, "");

        if (this.args.ansible) {
          if (s.startsWith("ok: ")) {
            this.log.ansibleOK(s);
          } else if (s.startsWith("changed: ")) {
            this.log.ansibleChanged(s);
          } else if (s.startsWith("skipping: ")) {
            this.log.ansibleSkipping(s);
          } else if (s.startsWith("error: ")) {
            this.log.ansibleError(s);
          } else {
            this.log.info(s);
          }
        } else {
          this.log.info(s);
        }
      });
      cp.stderr.on("data", data => {
        const s = data.toString().replace(re, "");

        if (s !== "npm" && s !== "notice" && s !== "npm notice") {
          this.log.info(s);
        }
      });
      cp.on("error", () => {
        reject();
      });
      cp.on("exit", function (code) {
        if (code !== 0) {
          reject();
        } else {
          resolve();
        }
      });
    });
  }

  async startAll() {
    this.ensureCommands(["osascript"]);

    const tmpObjMain = _tmp.default.fileSync();

    const tmpObjHelper = _tmp.default.fileSync();

    const preferActors = !!this.args.actors;
    await (0, _fsExtra.writeFile)(tmpObjHelper.name, `# function for setting iTerm2 titles
function title {
  printf "\\x1b]0;%s\\x7" "$1"
}

# function for setting iTerm2 tab colors
function tab-color {
  printf "\\x1b]6;1;bg;red;brightness;%s\\x7" "$1"
  printf "\\x1b]6;1;bg;green;brightness;%s\\x7" "$2"
  printf "\\x1b]6;1;bg;blue;brightness;%s\\x7" "$3"
}
`);
    let script = `
tell application "iTerm"
  tell (create window with default profile)
    `;
    let firstTab = true; // Loop through package.json dirs

    for (const dirName of this.pkgInfo.order) {
      const pkg = this.pkgInfo.pkgs.get(dirName);

      if (!pkg.content.scripts) {
        continue;
      }

      let tabDetails = [];

      if (preferActors) {
        const actorNames = Object.getOwnPropertyNames(pkg.content.scripts).filter(s => s.startsWith("actor:") && !s.endsWith(":debug"));

        if (actorNames.length > 0) {
          tabDetails = actorNames.map(name => ({
            name,
            title: name.substring("actor:".length),
            color: "255 198 0"
          }));
        }
      }

      if (tabDetails.length === 0) {
        if (!pkg.content.scripts.start) {
          continue;
        }

        const isLibrary = pkg.content.keywords && (Array.isArray(pkg.content.keywords) && pkg.content.keywords.includes("library") || pkg.content.keywords.hasOwnProperty("library"));
        tabDetails = [{
          name: "start",
          title: _path.default.basename(dirName),
          color: isLibrary ? "0 255 0" : "0 198 255"
        }];
      }

      tabDetails.forEach(detail => {
        if (firstTab) {
          script += `
    tell current session of current tab
      write text "cd ${dirName}; title ${detail.title}; tab-color ${detail.color}; npm run ${detail.name}"
    end tell
`;
          firstTab = false;
        } else {
          script += `
    set newTab to (create tab with default profile)
    tell newTab
      tell current session of newTab
        write text "cd ${dirName}; title ${detail.title}; tab-color ${detail.color}; npm run ${detail.name}"
      end tell
    end tell
`;
        }
      });
    }

    script += `
  end tell
end tell
`;
    await (0, _fsExtra.writeFile)(tmpObjMain.name, script);

    if (this.args.debug) {
      this.log.info(script);
    }

    await this.execWithOutput(`source ${tmpObjHelper.name}; osascript < ${tmpObjMain.name}`, {
      shell: "/bin/bash"
    });
  }

  async test(dirName) {
    const pkg = this.pkgInfo.pkgs.get(dirName);

    if (pkg.content.scripts && pkg.content.scripts.test) {
      this.log.info2(`Testing '${_path.default.basename(dirName)}'...`);
      await this.execWithOutput(`npm test`, {
        cwd: dirName
      });
    }
  }

  async testAll() {
    this.ensureCommands(["npm"]);

    for (const dirName of this.pkgInfo.order) {
      await this.test(dirName);
    }
  }

  async clean(dirName) {
    const name = _path.default.basename(dirName);

    this.log.info2(`Cleaning '${name}'...`);
    await (0, _fsExtra.remove)(_path.default.join(dirName, "node_modules"));
    await (0, _fsExtra.remove)(_path.default.join(dirName, "package-lock.json"));
    await (0, _fsExtra.remove)(_path.default.join(dirName, "dist"));
    await (0, _fsExtra.remove)(_path.default.join(dirName, "build"));
  }

  async cleanAll() {
    this.ensureCommands(["npm"]);

    for (const dirName of this.pkgInfo.order) {
      await this.clean(dirName);
    }
  }

  async install(dirName) {
    const name = _path.default.basename(dirName);

    if (this.args.clean) {
      await this.clean(dirName);
    }

    this.log.info2(`Installing modules in '${name}'...`);
    await this.execWithOutput(`npm install`, {
      cwd: dirName
    });
  }

  async installAll() {
    this.ensureCommands(["npm"]);

    for (const dirName of this.pkgInfo.order) {
      await this.install(dirName);
    }
  }

  async update(dirName) {
    const pkg = this.pkgInfo.pkgs.get(dirName);

    const name = _path.default.basename(dirName);

    for (const pkgName of this.args.packages) {
      if (pkg.content.dependencies && pkg.content.dependencies[pkgName] || pkg.content.devDependencies && pkg.content.devDependencies[pkgName]) {
        this.log.info2(`Update '${pkgName}' in '${name}'...`);
        await this.execWithOutput(`npm update ${pkgName}`, {
          cwd: dirName
        });
      }
    }
  }

  async updateAll() {
    this.ensureCommands(["npm"]);

    for (const dirName of this.pkgInfo.order) {
      await this.update(dirName);
    }
  }

  async build(dirName) {
    const pkg = this.pkgInfo.pkgs.get(dirName);

    const name = _path.default.basename(dirName);

    if (this.args.install) {
      await this.install(dirName);
    }

    if (pkg.content.scripts && pkg.content.scripts.build) {
      this.log.info2(`Building '${name}'...`);
      await this.execWithOutput("npm run build", {
        cwd: dirName
      });
    }
  }

  async buildAll() {
    this.ensureCommands(["npm"]);

    for (const dirName of this.pkgInfo.order) {
      await this.build(dirName);
    }
  }

  async deploy(dirName) {
    const pkg = this.pkgInfo.pkgs.get(dirName);

    const name = _path.default.basename(dirName);

    if (pkg.content.scripts && pkg.content.scripts.deploy) {
      this.log.info2(`Deploying '${name}'...`);
      await this.execWithOutput("npm run deploy", {
        cwd: dirName
      });
    }
  }

  async deployAll() {
    this.ensureCommands(["npm"]);

    for (const dirName of this.pkgInfo.order) {
      await this.deploy(dirName);
    }
  }

  async release(dirName) {
    const name = _path.default.basename(dirName);

    this.log.info2(`Releasing '${name}'...`);
    this.log.info2("Checking for Uncommitted Changes...");

    try {
      await this.execWithOutput("git diff-index --quiet HEAD --");
    } catch (error) {
      throw new Error("There are uncomitted changes - commit or stash them and try again");
    }

    this.log.info2("Pulling...");
    await this.execWithOutput("git pull");
    this.log.info2("Updating Version...");
    await (0, _fsExtra.ensureDir)("scratch");
    const incrFlag = this.args.patch ? "-i patch" : this.args.minor ? "-i minor" : this.args.major ? "-i major" : "";
    await this.execWithOutput(`npx stampver ${incrFlag} -u -s`);
    const tagName = await (0, _fsExtra.readFile)("scratch/version.tag.txt");
    const tagDescription = await (0, _fsExtra.readFile)("scratch/version.desc.txt");

    try {
      this.log.info2("Installing...");
      await this.install(dirName);
      this.log.info2("Building...");
      await this.build(dirName);
      this.log.info2("Testing...");
      await this.test(dirName);
      this.log.info2("Committing Version Changes...");
      await this.execWithOutput("git add :/");

      if (this.args.patch || this.args.minor || this.args.major) {
        this.log.info2("Tagging...");
        await this.execWithOutput(`git tag -a ${tagName} -m '${tagDescription}'`);
      }

      await this.execWithOutput(`git commit -m '${tagDescription}'`);
    } catch (error) {
      // Roll back version changes if anything went wrong
      await this.execWithOutput("git checkout -- .");
      return;
    }

    this.log.info2("Pushing to Git...");
    await this.execWithOutput("git push --follow-tags");

    if (this.args.deploy) {
      await this.deploy(dirName);
    }
  }

  async releaseAll() {
    this.ensureCommands(["stampver", "git", "npx", "npm"]);

    if (!this.args.patch && !this.args.minor && !this.args.major) {
      this.log.warning(`Major, minor or patch number must be incremented for release`);
      return;
    }

    for (const dirName of this.pkgInfo.order) {
      await this.release(dirName);
    }
  }

  async run(argv) {
    const options = {
      boolean: ["help", "version", "patch", "minor", "major", "clean", "install", "actors", "debug", "ansible"],
      alias: {
        a: "actors"
      }
    };
    this.args = (0, _minimist.default)(argv, options);

    if (this.args.version) {
      this.log.info(`${_version.fullVersion}`);
      return 0;
    }

    this.pkgInfo = await this.getPackageInfo();
    let command = this.args._[0];
    command = command ? command.toLowerCase() : "help";

    switch (command) {
      case "start":
        if (this.args.help) {
          this.log.info(`Usage: ${this.toolName} start [options]

Description:

Recursively runs 'npm start' in all directories containing 'package.json' except 'node_modules/**'.

Options:
  --actors, -a    If one or more 'actor:*' scripts are found in the package.json,
                  run those instead of the 'start' script, if it exists.
`);
          return 0;
        }

        await this.startAll();
        break;

      case "build":
        if (this.args.help) {
          this.log.info(`Usage: ${this.toolName} build

Description:

Recursively runs 'npm run build' in all directories containing 'package.json' except 'node_modules/**'.

Options:
  --install       Recursively runs 'npm install' before building
  --clean         If '--install' is specified, does a '--clean' first
`);
          return 0;
        }

        await this.buildAll();
        break;

      case "deploy":
        if (this.args.help) {
          this.log.info(`Usage: ${this.toolName} deploy

Description:

Recursively runs 'npm run deploy' in all directories containing 'package.json' except 'node_modules/**'.
`);
          return 0;
        }

        await this.deployAll();
        break;

      case "test":
        if (this.args.help) {
          this.log.info(`Usage: ${this.toolName} test

Description:

Recursively runs 'npm test' in all directories containing 'package.json' except 'node_modules/**'.
`);
          return 0;
        }

        await this.testAll();
        break;

      case "release":
        if (this.args.help) {
          this.log.info(`Usage: ${this.toolName} release [options]

Description:

Increment version information with 'stampver', runs 'snap build', 'snap test',
tags local Git repo, pushes changes then optionally releases to NPM.

Options:
  --major       Release major version
  --minor       Release minor version
  --patch       Release a patch
  --deploy      Run a deployment after a success release
`);
          return 0;
        }

        await this.releaseAll();
        break;

      case "clean":
        if (this.args.help) {
          this.log.info(`Usage: ${this.toolName} clean

Description:

Recursively deletes all 'dist' and 'node_modules' directories, and 'package-lock.json' files.
`);
          return 0;
        }

        await this.cleanAll();
        break;

      case "install":
        if (this.args.help) {
          this.log.info(`Usage: ${this.toolName} install

Description:

Recursively runs 'npm install' in all directories containing 'package.json' except 'node_modules/**'.
`);
          return 0;
        }

        await this.installAll();
        break;

      case "update":
        if (this.args.help) {
          this.log.info(`Usage: ${this.toolName} update

Description:

Recursively runs 'npm update <pkg>,...' in all directories containing 'package.json' except 'node_modules/**'.
`);
          return 0;
        }

        this.args.packages = this.args._.slice(1);
        await this.updateAll();
        break;

      case "help":
      default:
        this.log.info(`
Usage: ${this.toolName} <cmd> [options]

Description:

Current directory must contain a package.json, which can be a dummy file.
Operates on all sub-directories containing a package.json excluding
node_modules directories.

Commands:
  start       Run 'npm start' in new terminal tabs.
              Requires iTerm2 (https://www.iterm2.com/)
  build       Run 'npm run build'
  deploy      Run 'npm run deploy'
  test        Run 'npm test'
  update      Run 'npm update'
  install     Run 'npm install'
  clean       Remove 'node_modules' and distribution files
  release     Increment version, build, test, tag and release

Global Options:
  --help      Shows this help
  --version   Shows the tool version
  --debug     Enable debugging output
  --ansible   Colorize Ansible output if detected
`);
        return 0;
    }

    return 0;
  }

}

exports.SnapTool = SnapTool;
//# sourceMappingURL=SnapTool.js.map