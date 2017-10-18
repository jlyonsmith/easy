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

var _tempy = require('tempy');

var _tempy2 = _interopRequireDefault(_tempy);

var _commandExists = require('command-exists');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class SnapTool {
  constructor(log) {
    this.log = log;
  }

  static ensureCommands(cmds) {
    cmds.forEach(cmd => {
      if (!(0, _commandExists.sync)(cmd)) {
        throw new Error(`Command '${cmd}' does not exist.  Please install it.`);
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
    SnapTool.ensureCommands(['osascript']);

    const tempFile = _tempy2.default.file();
    const rootDir = _process2.default.cwd();

    let script = `
    tell application "iTerm"
      tell (create window with default profile)
    `;
    project.order.forEach((dirname, index) => {
      const pkg = project.pkgs.get(dirname);

      // Ignore the root project if it's not the only entry
      if (pkg === project.rootPkg && project.pkgs.size > 1) {
        return;
      }

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

  buildAll(project) {
    SnapTool.ensureCommands(['npm']);
    project.order.forEach((dirname, index) => {
      const pkg = project.pkgs.get(dirname);
      const name = _path2.default.basename(dirname);

      if (pkg.content.scripts && pkg.content.scripts.build) {
        if (this.args.clean) {
          this.log.info(`Cleaning '${name}'...`);
          (0, _fsExtra.removeSync)('node_modules');
          (0, _fsExtra.removeSync)('package-lock.json');
          (0, _fsExtra.removeSync)('dist');
          this.log.info('Installing Packages...');
          (0, _child_process.execSync)('npm install');
        }

        // Skip build for root project if there are multiple
        if (pkg === project.rootPkg && project.pkgs.size > 1) {
          return;
        }

        this.log.info(`Building '${name}'...`);
        (0, _child_process.execSync)('npm run build', { cwd: dirname });
      }
    });
  }

  testAll(project) {
    SnapTool.ensureCommands(['npm']);
    project.order.forEach((dirname, index) => {
      const pkg = project.pkgs.get(dirname);

      // Skip test for root project if there are multiple
      if (pkg === project.rootPkg && project.pkgs.size > 1) {
        return;
      }

      if (pkg.content && pkg.content.scripts.build) {
        this.log.info(`Testing '${_path2.default.basename(dirname)}'...`);
        (0, _child_process.execSync)(`npm run test`, { cwd: dirname });
      }
    });
  }

  release(project) {
    SnapTool.ensureCommands(['stampver', 'git', 'npx', 'npm']);
    this.log.info('Checking for Uncommitted Changes...');
    try {
      (0, _child_process.execSync)('git diff-index --quiet HEAD --');
    } catch (error) {
      throw new Error('There are uncomitted changes - commit or stash them and try again');
    }

    this.log.info('Pulling...');
    (0, _child_process.execSync)('git pull');
    this.log.info('Building...');
    this.buildAll(project);
    this.log.info('Testing...');
    this.testAll(project);
    this.log.info('Updating Version...');
    (0, _fsExtra.ensureDirSync)('scratch');

    const incrFlag = this.args.patch ? '-i patch' : this.args.minor ? '-i minor' : this.args.major ? '-i major' : '';

    (0, _child_process.execSync)(`npx stampver ${incrFlag} -u`);
    const tagName = (0, _fsExtra.readFileSync)('scratch/version.tag.txt');
    const tagDescription = (0, _fsExtra.readFileSync)('scratch/version.desc.txt');

    this.log.info('Committing Version Changes...');
    (0, _child_process.execSync)(`git add :/`);

    if (this.args.patch || this.args.minor || this.args.major) {
      this.log.info('Tagging...');
      (0, _child_process.execSync)(`git tag -a ${tagName} -m '${tagDescription}'`);
    }

    (0, _child_process.execSync)(`git commit -m '${tagDescription}'`);

    this.log.info('Pushing...');
    (0, _child_process.execSync)('git push --follow-tags');

    if (project.pkgs.size === 1 && !project.rootPkg.content.private) {
      if (!this.args.patch && !this.args.minor && !this.args.major) {
        this.log.error(`Not pushing to NPM as major, minor or patch number must be incremented`);
        return;
      }
      this.log.info('Publishing...');
      (0, _child_process.execSync)('npm publish');
    }
  }

  async run(argv) {
    const options = {
      boolean: ['help', 'version', 'patch', 'minor', 'major', 'clean']
    };
    this.args = (0, _minimist2.default)(argv, options);

    const command = this.args._[0];

    if (this.args.help || !command) {
      this.log.info(`
usage: snap <cmd> [options]

commands:
  start            Run 'npm start' for all projects
  build            Run 'npm build' for all projects
  test             Run 'npm test' for all projects
  release          Increment version, run build' and 'test', tag and release non-private to 'npm'

options:
  --patch | --minor | --major   Release a patch, minor or major version. For 'release' command only.
  --clean                       Do a clean build.  For 'build' command only.
`);
      return 0;
    }

    if (this.args.version) {
      this.log.info(`{$fullVersion}`);
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
      default:
        this.log.error('Use --help to see available commands');
        return -1;
    }

    return 0;
  }
}
exports.SnapTool = SnapTool;
//# sourceMappingURL=SnapTool.js.map