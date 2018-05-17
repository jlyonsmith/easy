"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.SnapTool = undefined;

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _glob = require("glob");

var _minimist = require("minimist");

var _minimist2 = _interopRequireDefault(_minimist);

var _version = require("./version");

var _util = require("util");

var _util2 = _interopRequireDefault(_util);

var _toposort = require("toposort");

var _toposort2 = _interopRequireDefault(_toposort);

var _fsExtra = require("fs-extra");

var _path = require("path");

var _path2 = _interopRequireDefault(_path);

var _process = require("process");

var _process2 = _interopRequireDefault(_process);

var _child_process = require("child_process");

var _tmp = require("tmp");

var _tmp2 = _interopRequireDefault(_tmp);

var _commandExists = require("command-exists");

var _readlineSync = require("readline-sync");

var _readlineSync2 = _interopRequireDefault(_readlineSync);

var _chalk = require("chalk");

var _chalk2 = _interopRequireDefault(_chalk);

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

  getProject() {
    if (!(0, _fsExtra.existsSync)("package.json")) {
      throw new Error("The current directory does not contain a package.json file");
    }

    const filenames = (0, _glob.sync)("**/package.json", {
      ignore: ["**/node_modules/**", "**/scratch/**"],
      realpath: true
    });
    const dirNames = filenames.map(filename => _path2.default.dirname(filename));
    const pkgMap = new Map(dirNames.map(dirName => [dirName, {}]));
    let edges = [];
    let rootPkg = null;

    for (let pair of pkgMap) {
      const [dirName, pkg] = pair;
      const content = JSON.parse((0, _fsExtra.readFileSync)(dirName + "/package.json", { encoding: "utf8" }));

      pkg.content = content;

      if (dirName === _process2.default.cwd()) {
        rootPkg = pkg;
      } else if (content.dependencies) {
        const prefix = "file:";

        Object.entries(content.dependencies).forEach(arr => {
          if (arr[1].startsWith(prefix)) {
            const otherdirName = _path2.default.resolve(_path2.default.join(dirName, arr[1].substring(prefix.length)));

            if (pkgMap.has(otherdirName)) {
              edges.push([dirName, otherdirName]);
            }
          }
        });
      }
    }

    return {
      pkgs: pkgMap,
      order: _toposort2.default.array(dirNames, edges).reverse(),
      rootPkg
    };
  }

  startAll(project) {
    this.ensureCommands(["osascript"]);

    const tempFile = _tmp2.default.fileSync().name;
    const rootDir = _process2.default.cwd();
    const preferActors = !!this.args.actors;

    let script = `
    tell application "iTerm"
      tell (create window with default profile)
    `;
    project.order.forEach((dirName, index) => {
      const pkg = project.pkgs.get(dirName);

      if (!pkg.content.scripts) {
        return;
      }

      let details = [];

      if (preferActors) {
        const actorNames = Object.getOwnPropertyNames(pkg.content.scripts).filter(s => s.startsWith("actor:") && !s.endsWith(":debug"));

        if (actorNames.length > 0) {
          details = actorNames.map(name => ({
            name,
            title: name.substring("actor:".length),
            color: "255 198 0"
          }));
        }
      }

      if (details.length === 0) {
        if (!pkg.content.scripts.start) {
          return;
        }

        const isLibrary = pkg.content.keywords && (Array.isArray(pkg.content.keywords) && pkg.content.keywords.includes("library") || pkg.content.keywords.hasOwnProperty("library"));

        details = [{
          name: "start",
          title: _path2.default.basename(dirName),
          color: isLibrary ? "0 255 0" : "0 198 255"
        }];
      }

      details.forEach(detail => {
        if (index == 0) {
          script += `
          tell current session of current tab
          write text "cd ${dirName}; title ${detail.title}; tab-color ${detail.color}; npm run ${detail.name}"
          end tell
          `;
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
    });
    script += `
      end tell
    end tell
    `;

    (0, _fsExtra.writeFileSync)(tempFile, script);
    (0, _child_process.execSync)(`osascript < ${tempFile}`);
  }

  testAll(project) {
    this.ensureCommands(["npm"]);
    project.order.forEach((dirName, index) => {
      const pkg = project.pkgs.get(dirName);

      if (pkg.content.scripts && pkg.content.scripts.test) {
        this.log.info2(`Testing '${_path2.default.basename(dirName)}'...`);
        (0, _child_process.execSync)(`npm test`, { cwd: dirName });
      }
    });
  }

  cleanAll(project) {
    this.ensureCommands(["npm"]);

    project.order.forEach((dirName, index) => {
      const name = _path2.default.basename(dirName);

      this.log.info2(`Cleaning '${name}'...`);
      (0, _fsExtra.removeSync)(_path2.default.join(dirName, "node_modules"));
      (0, _fsExtra.removeSync)(_path2.default.join(dirName, "package-lock.json"));
      (0, _fsExtra.removeSync)(_path2.default.join(dirName, "dist"));
      (0, _fsExtra.removeSync)(_path2.default.join(dirName, "build"));
    });
  }

  installAll(project) {
    this.ensureCommands(["npm"]);

    if (this.args.clean) {
      this.cleanAll(project);
    }

    project.order.forEach((dirName, index) => {
      const pkg = project.pkgs.get(dirName);
      const name = _path2.default.basename(dirName);

      this.log.info2(`Installing modules in '${name}'...`);
      (0, _child_process.execSync)(`npm install`, { cwd: dirName });
    });
  }

  updateAll(project) {
    this.ensureCommands(["npm"]);

    project.order.forEach((dirName, index) => {
      const pkg = project.pkgs.get(dirName);
      const name = _path2.default.basename(dirName);

      this.args.packages.forEach(pkgName => {
        if (pkg.content.dependencies && pkg.content.dependencies[pkgName] || pkg.content.devDependencies && pkg.content.devDependencies[pkgName]) {
          this.log.info2(`Update '${pkgName}' in '${name}'...`);
          (0, _child_process.execSync)(`npm update ${pkgName}`, { cwd: dirName });
        }
      });
    });
  }

  buildAll(project) {
    this.ensureCommands(["npm"]);

    if (this.args.install) {
      this.installAll(project);
    }

    project.order.forEach((dirName, index) => {
      const pkg = project.pkgs.get(dirName);
      const name = _path2.default.basename(dirName);

      if (pkg.content.scripts && pkg.content.scripts.build) {
        this.log.info2(`Building '${name}'...`);
        (0, _child_process.execSync)("npm run build", { cwd: dirName });
      }
    });
  }

  deployAll(project) {
    this.ensureCommands(["npm"]);

    let defaultUser = _process2.default.env.SNAP_DEPLOY_USER || "";
    let defaultHost = _process2.default.env.SNAP_DEPLOY_HOST || "";
    let user = _readlineSync2.default.question("Deploy as user? " + _chalk2.default.gray(`[${defaultUser}]`) + " ") || defaultUser;
    let host = _readlineSync2.default.question("Deploy to host? " + _chalk2.default.gray(`[${defaultHost}]`) + " ") || defaultHost;

    if (!user || !host) {
      this.log.error("Deployment user and host must be specified.");
    }

    project.order.forEach((dirName, index) => {
      const pkg = project.pkgs.get(dirName);
      const name = _path2.default.basename(dirName);

      if (pkg.content.scripts && pkg.content.scripts.deploy) {
        this.log.info2(`Deploying '${name}'...`);
        (0, _child_process.execSync)("npm run deploy", {
          cwd: dirName,
          env: _extends({}, _process2.default.env, {
            SNAP_DEPLOY_USER: user,
            SNAP_DEPLOY_HOST: host
          })
        });
      }
    });
  }

  release(project) {
    this.ensureCommands(["stampver", "git", "npx", "npm"]);

    if (!this.args.patch && !this.args.minor && !this.args.major) {
      this.log.warning(`Major, minor or patch number must be incremented for release`);
      return;
    }

    this.log.info2("Checking for Uncommitted Changes...");
    try {
      (0, _child_process.execSync)("git diff-index --quiet HEAD --");
    } catch (error) {
      throw new Error("There are uncomitted changes - commit or stash them and try again");
    }

    this.log.info2("Pulling...");
    (0, _child_process.execSync)("git pull");

    this.log.info2("Updating Version...");
    (0, _fsExtra.ensureDirSync)("scratch");

    const incrFlag = this.args.patch ? "-i patch" : this.args.minor ? "-i minor" : this.args.major ? "-i major" : "";

    (0, _child_process.execSync)(`npx stampver ${incrFlag} -u`);
    const tagName = (0, _fsExtra.readFileSync)("scratch/version.tag.txt");
    const tagDescription = (0, _fsExtra.readFileSync)("scratch/version.desc.txt");

    try {
      this.log.info2("Building...");
      this.buildAll(project);
      this.log.info2("Testing...");
      this.testAll(project);

      this.log.info2("Committing Version Changes...");
      (0, _child_process.execSync)("git add :/");

      if (this.args.patch || this.args.minor || this.args.major) {
        this.log.info2("Tagging...");
        (0, _child_process.execSync)(`git tag -a ${tagName} -m '${tagDescription}'`);
      }

      (0, _child_process.execSync)(`git commit -m '${tagDescription}'`);
    } catch (error) {
      // Roll back version changes if anything went wrong
      (0, _child_process.execSync)("git checkout -- .");
      return;
    }

    this.log.info2("Pushing to Git...");
    (0, _child_process.execSync)("git push --follow-tags");

    if (this.args.npm && project.pkgs.size >= 1 && !project.rootPkg.content.private) {
      this.log.info2("Publishing to NPM...");
      (0, _child_process.execSync)("npm publish");
    }
  }

  async run(argv) {
    const options = {
      boolean: ["help", "version", "patch", "minor", "major", "clean", "install", "actors", "npm"],
      alias: {
        a: "actors"
      }
    };
    this.args = (0, _minimist2.default)(argv, options);

    if (this.args.version) {
      this.log.info(`${_version.fullVersion}`);
      return 0;
    }

    const project = this.getProject();
    let command = this.args._[0];

    command = command ? command.toLowerCase() : "help";

    switch (command) {
      case "start":
        if (this.args.help) {
          this.log.info(`Usage: ${this.toolName} start [options]

Description:

Recursively run 'npm start' in all directories containing 'package.json' except 'node_modules/**'.

Options:
  --actors, -a    If one or more 'actor:*' scripts are found in the package.json,
                  run those instead of the 'start' script, if it exists.
`);
          return 0;
        }
        this.startAll(project);
        break;

      case "build":
        if (this.args.help) {
          this.log.info(`Usage: ${this.toolName} build

Description:

Recursively run 'npm run build' in all directories containing 'package.json' except 'node_modules/**'.

Options:
  --install       Recursively runs 'npm install' before building
  --clean         If '--install' is specified, does a 'clean' first
`);
          return 0;
        }
        this.buildAll(project);
        break;

      case "deploy":
        if (this.args.help) {
          this.log.info(`Usage: ${this.toolName} deploy

Description:

Recursively run 'npm run deploy' in all directories containing 'package.json' except 'node_modules/**'.
You can set default values for the deployment user and host by setting the environment variables
SNAP_DEPLOY_USER and SNAP_DEPLOY_HOST.
`);
          return 0;
        }
        this.deployAll(project);
        break;

      case "test":
        if (this.args.help) {
          this.log.info(`Usage: ${this.toolName} test

Description:

Recursively runs 'npm test' in all directories containing 'package.json' except 'node_modules/**'.
`);
          return 0;
        }
        this.testAll(project);
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
  --npm         Push a non-private build to NPM (http://npmjs.org)
`);
          return 0;
        }
        this.release(project);
        break;

      case "clean":
        if (this.args.help) {
          this.log.info(`Usage: ${this.toolName} clean

Description:

Recursively deletes all 'dist' and 'node_modules' directories, and 'package-lock.json' files.
`);
          return 0;
        }
        this.cleanAll(project);
        break;

      case "install":
        if (this.args.help) {
          this.log.info(`Usage: ${this.toolName} install

Description:

Recursively run 'npm install' in all directories containing 'package.json' except 'node_modules/**'.
`);
          return 0;
        }
        this.installAll(project);
        break;

      case "update":
        if (this.args.help) {
          this.log.info(`Usage: ${this.toolName} update

Description:

Runs 'npm update' in all directories containing 'package.json' except 'node_modules/**'.
`);
          return 0;
        }
        this.args.packages = this.args._.slice(1);
        this.updateAll(project);
        break;

      case "help":
      default:
        this.log.info(`
Usage: ${this.toolName} <cmd> [options]

Commands:
  start       Run 'npm start' for all projects in new terminal tabs.
              Requires iTerm2 (https://www.iterm2.com/)
  build       Run 'npm run build' for all projects
  deploy      Run 'npm run deploy' for all projects
  test        Run 'npm test' for all projects
  update      Run 'npm update <pkg>...' for all projects
  install     Run 'npm install' for all projects
  clean       Remove 'node_modules' and distribution files for all packages
  release     Increment version, build, test, tag and release

Global Options:
  --help                        Shows this help.
  --version                     Shows the tool version.
`);
        return 0;
    }

    return 0;
  }
}
exports.SnapTool = SnapTool;
//# sourceMappingURL=SnapTool.js.map