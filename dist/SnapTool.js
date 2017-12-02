'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.SnapTool = undefined;

var _glob = require('glob');

var _minimist = require('minimist');

var _minimist2 = _interopRequireDefault(_minimist);

var _version = require('./version');

var _util = require('util');

var _util2 = _interopRequireDefault(_util);

var _toposort = require('toposort');

var _toposort2 = _interopRequireDefault(_toposort);

var _fsExtra = require('fs-extra');

var _path = require('path');

var _path2 = _interopRequireDefault(_path);

var _process = require('process');

var _process2 = _interopRequireDefault(_process);

var _child_process = require('child_process');

var _tmp = require('tmp');

var _tmp2 = _interopRequireDefault(_tmp);

var _commandExists = require('command-exists');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class SnapTool {
  constructor(log) {
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
    if (!(0, _fsExtra.existsSync)('package.json')) {
      throw new Error('The current directory does not contain a package.json file');
    }

    const filenames = (0, _glob.sync)('**/package.json', { ignore: ['**/node_modules/**', '**/scratch/**'], realpath: true });
    const dirnames = filenames.map(filename => _path2.default.dirname(filename));
    const pkgMap = new Map(dirnames.map(dirname => [dirname, {}]));
    let edges = [];
    let rootPkg = null;

    for (let pair of pkgMap) {
      const [dirname, pkg] = pair;
      const content = JSON.parse((0, _fsExtra.readFileSync)(dirname + '/package.json', { encoding: 'utf8' }));

      pkg.content = content;

      if (dirname === _process2.default.cwd()) {
        rootPkg = pkg;
      } else if (content.dependencies) {
        const prefix = 'file:';

        Object.entries(content.dependencies).forEach(arr => {
          if (arr[1].startsWith(prefix)) {
            const otherDirname = _path2.default.resolve(_path2.default.join(dirname, arr[1].substring(prefix.length)));

            if (pkgMap.has(otherDirname)) {
              edges.push([dirname, otherDirname]);
            }
          }
        });
      }
    }

    return {
      pkgs: pkgMap,
      order: _toposort2.default.array(dirnames, edges).reverse(),
      rootPkg
    };
  }

  startAll(project) {
    this.ensureCommands(['osascript']);

    const tempFile = _tmp2.default.fileSync().name;
    const rootDir = _process2.default.cwd();

    let script = `
    tell application "iTerm"
      tell (create window with default profile)
    `;
    project.order.forEach((dirname, index) => {
      const pkg = project.pkgs.get(dirname);

      if (!pkg.content.scripts || !pkg.content.scripts.start) {
        return;
      }

      const name = _path2.default.basename(dirname);
      let color;
      if (pkg.content.keywords && pkg.content.keywords.includes('library')) {
        color = '0 255 0';
      } else {
        color = '0 198 255';
      }
      if (index == 0) {
        script += `
        tell current session of current tab
          write text "cd ${dirname}; title ${name}; tab-color ${color}; npm start"
        end tell
        `;
      } else {
        script += `
        set newTab to (create tab with default profile)
        tell newTab
          tell current session of newTab
            write text "cd ${dirname}; title ${name}; tab-color ${color}; npm start"
          end tell
        end tell
        `;
      }
    });
    script += `
      end tell
    end tell
    `;

    (0, _fsExtra.writeFileSync)(tempFile, script);
    (0, _child_process.execSync)(`osascript < ${tempFile}`);
  }

  testAll(project) {
    this.ensureCommands(['npm']);
    project.order.forEach((dirname, index) => {
      const pkg = project.pkgs.get(dirname);

      if (pkg.content.scripts && pkg.content.scripts.test) {
        this.log.info2(`Testing '${_path2.default.basename(dirname)}'...`);
        (0, _child_process.execSync)(`npm test`, { cwd: dirname });
      }
    });
  }

  installAll(project) {
    this.ensureCommands(['npm']);

    if (this.args.clean) {
      this.cleanAll(project);
    }

    project.order.forEach((dirname, index) => {
      const pkg = project.pkgs.get(dirname);
      const name = _path2.default.basename(dirname);

      this.log.info2(`Installing '${name}'...`);
      (0, _child_process.execSync)(`npm install`, { cwd: dirname });
    });
  }

  cleanAll(project) {
    this.ensureCommands(['npm']);

    project.order.forEach((dirname, index) => {
      const name = _path2.default.basename(dirname);

      this.log.info2(`Cleaning '${name}'...`);
      (0, _fsExtra.removeSync)(_path2.default.join(dirname, 'node_modules'));
      (0, _fsExtra.removeSync)(_path2.default.join(dirname, 'package-lock.json'));
      (0, _fsExtra.removeSync)(_path2.default.join(dirname, 'dist'));
    });
  }

  updateAll(project) {
    this.ensureCommands(['npm']);

    project.order.forEach((dirname, index) => {
      const pkg = project.pkgs.get(dirname);
      const name = _path2.default.basename(dirname);

      this.args.packages.forEach(pkgName => {
        if (pkg.content.dependencies && pkg.content.dependencies[pkgName] || pkg.content.devDependencies && pkg.content.devDependencies[pkgName]) {
          this.log.info2(`Update '${pkgName}' in '${name}'...`);
          (0, _child_process.execSync)(`npm update ${pkgName}`, { cwd: dirname });
        }
      });
    });
  }

  buildAll(project) {
    this.ensureCommands(['npm']);

    if (this.args.clean) {
      this.installAll(project);
    }

    project.order.forEach((dirname, index) => {
      const pkg = project.pkgs.get(dirname);
      const name = _path2.default.basename(dirname);

      if (pkg.content.scripts && pkg.content.scripts.build) {
        this.log.info2(`Building '${name}'...`);
        (0, _child_process.execSync)('npm run build', { cwd: dirname });
      }
    });
  }

  release(project) {
    this.ensureCommands(['stampver', 'git', 'npx', 'npm']);
    this.log.info2('Checking for Uncommitted Changes...');
    try {
      (0, _child_process.execSync)('git diff-index --quiet HEAD --');
    } catch (error) {
      throw new Error('There are uncomitted changes - commit or stash them and try again');
    }

    this.log.info2('Pulling...');
    (0, _child_process.execSync)('git pull');

    this.log.info2('Updating Version...');
    (0, _fsExtra.ensureDirSync)('scratch');

    const incrFlag = this.args.patch ? '-i patch' : this.args.minor ? '-i minor' : this.args.major ? '-i major' : '';

    (0, _child_process.execSync)(`npx stampver ${incrFlag} -u`);
    const tagName = (0, _fsExtra.readFileSync)('scratch/version.tag.txt');
    const tagDescription = (0, _fsExtra.readFileSync)('scratch/version.desc.txt');

    try {
      this.log.info2('Building...');
      this.buildAll(project);
      this.log.info2('Testing...');
      this.testAll(project);

      this.log.info2('Committing Version Changes...');
      (0, _child_process.execSync)('git add :/');

      if (this.args.patch || this.args.minor || this.args.major) {
        this.log.info2('Tagging...');
        (0, _child_process.execSync)(`git tag -a ${tagName} -m '${tagDescription}'`);
      }

      (0, _child_process.execSync)(`git commit -m '${tagDescription}'`);
    } catch (error) {
      // Roll back version changes if anything went wrong
      (0, _child_process.execSync)('git checkout -- .');
      return;
    }

    this.log.info2('Pushing to Git...');
    (0, _child_process.execSync)('git push --follow-tags');

    if (project.pkgs.size >= 1 && !project.rootPkg.content.private) {
      if (!this.args.patch && !this.args.minor && !this.args.major) {
        this.log.warning(`Major, minor or patch number must be incremented to publish to NPM`);
        return;
      }
      this.log.info2('Publishing...');
      (0, _child_process.execSync)('npm publish');
    }
  }

  async run(argv) {
    const options = {
      boolean: ['help', 'version', 'patch', 'minor', 'major', 'clean']
    };
    this.args = (0, _minimist2.default)(argv, options);

    const command = this.args._[0];

    if (this.args.version) {
      this.log.info(`${_version.fullVersion}`);
      return 0;
    }

    if (this.args.help || !command) {
      this.log.info(`
usage: snap <cmd> [options]

commands:
  start       Run 'npm start' for all projects in new terminal tabs. Requires iTerm2 (https://www.iterm2.com/)
  build       Run 'npm build' for all projects
  test        Run 'npm test' for all projects
  update      Run 'npm update <pkg>...' for all projects
  install     Run 'npm install' for all projects
  clean       Remove 'node_modules' and distribution files for all packages
  release     Increment version, run build' and 'test', tag and release non-private to 'npm'

options:
  --patch | --minor | --major   Release a patch, minor or major version. For 'release' command only.
  --clean                       Do a clean 'build' or 'install'.
  --help                        Shows this help.
  --version                     Shows the tool version.
`);
      return 0;
    }

    const project = this.getProject();

    switch (command.toLowerCase()) {
      case 'start':
        this.startAll(project);
        break;
      case 'build':
        this.buildAll(project);
        break;
      case 'test':
        this.testAll(project);
        break;
      case 'release':
        this.release(project);
        break;
      case 'clean':
        this.cleanAll(project);
        break;
      case 'install':
        this.installAll(project);
        break;
      case 'update':
        this.args.packages = this.args._.slice(1);
        this.updateAll(project);
        break;
      default:
        this.log.error('Use --help to see available commands');
        return -1;
    }

    return 0;
  }
}
exports.SnapTool = SnapTool;
//# sourceMappingURL=SnapTool.js.map