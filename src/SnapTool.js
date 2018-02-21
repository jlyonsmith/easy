import { sync as globSync } from 'glob'
import parseArgs from 'minimist'
import { fullVersion } from './version'
import util from 'util'
import toposort from 'toposort'
import { readFileSync, writeFileSync, removeSync, existsSync, ensureDirSync } from 'fs-extra'
import path from 'path'
import process from 'process'
import { execSync } from 'child_process'
import tmp from 'tmp'
import { sync as commandExistsSync } from 'command-exists'

export class SnapTool {
  constructor(toolName, log) {
    this.toolName = toolName
    this.log = log
  }

  ensureCommands(cmds) {
    this.cmds = (this.cmds || new Set())

    cmds.forEach(cmd => {
      if (!this.cmds.has(cmd) &&!commandExistsSync(cmd)) {
        throw new Error(`Command '${cmd}' does not exist.  Please install it.`)
      } else {
        this.cmds.add(cmd)
      }
    })
  }

  getProject() {
    if (!existsSync('package.json')) {
      throw new Error('The current directory does not contain a package.json file')
    }

    const filenames = globSync('**/package.json',
      { ignore: ['**/node_modules/**', '**/scratch/**'], realpath: true })
    const dirNames = filenames.map(filename => (path.dirname(filename)))
    const pkgMap = new Map(dirNames.map(dirName => ([dirName, {}])))
    let edges = []
    let rootPkg = null

    for (let pair of pkgMap) {
      const [dirName, pkg] = pair
      const content = JSON.parse(readFileSync(dirName + '/package.json', { encoding: 'utf8' }))

      pkg.content = content

      if (dirName === process.cwd()) {
        rootPkg = pkg
      } else if (content.dependencies) {
        const prefix = 'file:'

        Object.entries(content.dependencies).forEach(arr => {
          if (arr[1].startsWith(prefix)) {
            const otherdirName = path.resolve(path.join(dirName, arr[1].substring(prefix.length)))

            if (pkgMap.has(otherdirName)) {
              edges.push([dirName, otherdirName])
            }
          }
        })
      }
    }

    return {
      pkgs: pkgMap,
      order: toposort.array(dirNames, edges).reverse(),
      rootPkg
    }
  }

  startAll(project) {
    this.ensureCommands(['osascript'])

    const tempFile = tmp.fileSync().name
    const rootDir = process.cwd()
    const preferActors = !!this.args.actors

    let script = `
    tell application "iTerm"
      tell (create window with default profile)
    `
    project.order.forEach((dirName, index) => {
      const pkg = project.pkgs.get(dirName)

      if (!pkg.content.scripts) {
        return
      }

      let scriptNames = []

      if (preferActors) {
        scriptNames = Object.getOwnPropertyNames(pkg.content.scripts).filter(s => s.startsWith('actor:') && !s.endsWith(':debug'))
      }

      if (scriptNames.length === 0) {
        if (pkg.content.scripts.start) {
          scriptNames = ['start']
        } else {
          return
        }
      }

      const isLibrary = (pkg.content.keywords &&
        ((Array.isArray(pkg.content.keywords) && pkg.content.keywords.includes('library')) || pkg.content.keywords.hasOwnProperty('library')))
      const packageName = path.basename(dirName)
      let color

      if (isLibrary) {
        color = '0 255 0'
      } else {
        color = '0 198 255'
      }

      scriptNames.forEach((scriptName) => {
        if (index == 0) {
          script += `
          tell current session of current tab
          write text "cd ${dirName}; title ${packageName}; tab-color ${color}; npm run ${scriptName}"
          end tell
          `
        } else {
          script += `
          set newTab to (create tab with default profile)
          tell newTab
          tell current session of newTab
          write text "cd ${dirName}; title ${packageName}; tab-color ${color}; npm run ${scriptName}"
          end tell
          end tell
          `
        }
      })
    })
    script += `
      end tell
    end tell
    `

    writeFileSync(tempFile, script)
    execSync(`osascript < ${tempFile}`)
  }

  testAll(project) {
    this.ensureCommands(['npm'])
    project.order.forEach((dirName, index) => {
      const pkg = project.pkgs.get(dirName)

      if (pkg.content.scripts && pkg.content.scripts.test) {
        this.log.info2(`Testing '${path.basename(dirName)}'...`)
        execSync(`npm test`, { cwd: dirName})
      }
    })
  }

  installAll(project) {
    this.ensureCommands(['npm'])

    if (this.args.clean) {
      this.cleanAll(project)
    }

    project.order.forEach((dirName, index) => {
      const pkg = project.pkgs.get(dirName)
      const name = path.basename(dirName)

      this.log.info2(`Installing '${name}'...`)
      execSync(`npm install`, { cwd: dirName})
    })
  }

  cleanAll(project) {
    this.ensureCommands(['npm'])

    project.order.forEach((dirName, index) => {
      const name = path.basename(dirName)

      this.log.info2(`Cleaning '${name}'...`)
      removeSync(path.join(dirName, 'node_modules'))
      removeSync(path.join(dirName, 'package-lock.json'))
      removeSync(path.join(dirName, 'dist'))
    })
  }

  updateAll(project) {
    this.ensureCommands(['npm'])

    project.order.forEach((dirName, index) => {
      const pkg = project.pkgs.get(dirName)
      const name = path.basename(dirName)

      this.args.packages.forEach((pkgName) => {
        if ((pkg.content.dependencies && pkg.content.dependencies[pkgName]) ||
          (pkg.content.devDependencies && pkg.content.devDependencies[pkgName])) {
          this.log.info2(`Update '${pkgName}' in '${name}'...`)
          execSync(`npm update ${pkgName}`, { cwd: dirName})
        }
      })
    })
  }

  buildAll(project) {
    this.ensureCommands(['npm'])

    if (this.args.clean) {
      this.installAll(project)
    }

    project.order.forEach((dirName, index) => {
      const pkg = project.pkgs.get(dirName)
      const name = path.basename(dirName)

      if (pkg.content.scripts && pkg.content.scripts.build) {
        this.log.info2(`Building '${name}'...`)
        execSync('npm run build', { cwd: dirName})
      }
    })
  }

  release(project) {
    this.ensureCommands(['stampver', 'git', 'npx', 'npm'])

    if (!this.args.patch && !this.args.minor && !this.args.major) {
      this.log.warning(`Major, minor or patch number must be incremented for release`)
      return
    }

    this.log.info2('Checking for Uncommitted Changes...')
    try {
      execSync('git diff-index --quiet HEAD --')
    } catch (error) {
      throw new Error('There are uncomitted changes - commit or stash them and try again')
    }

    this.log.info2('Pulling...')
    execSync('git pull')

    this.log.info2('Updating Version...')
    ensureDirSync('scratch')

    const incrFlag = this.args.patch ? '-i patch' : this.args.minor ? '-i minor' : this.args.major ? '-i major' : ''

    execSync(`npx stampver ${incrFlag} -u`)
    const tagName = readFileSync('scratch/version.tag.txt')
    const tagDescription = readFileSync('scratch/version.desc.txt')

    try {
      this.log.info2('Building...')
      this.buildAll(project)
      this.log.info2('Testing...')
      this.testAll(project)

      this.log.info2('Committing Version Changes...')
      execSync('git add :/')

      if (this.args.patch || this.args.minor || this.args.major) {
        this.log.info2('Tagging...')
        execSync(`git tag -a ${tagName} -m '${tagDescription}'`)
      }

      execSync(`git commit -m '${tagDescription}'`)
    } catch (error) {
      // Roll back version changes if anything went wrong
      execSync('git checkout -- .')
      return
    }

    this.log.info2('Pushing to Git...')
    execSync('git push --follow-tags')

    if (this.args.npm && project.pkgs.size >= 1 && !project.rootPkg.content.private) {
      this.log.info2('Publishing to NPM...')
      execSync('npm publish')
    }
  }

  async run(argv) {
    const options = {
      boolean: [ 'help', 'version', 'patch', 'minor', 'major', 'clean', 'actors', 'npm' ],
      alias: {
        'a': 'actors'
      }
    }
    this.args = parseArgs(argv, options)

    if (this.args.version) {
      this.log.info(`${fullVersion}`)
      return 0
    }

    const project = this.getProject()
    let command = this.args._[0]

    command = command ? command.toLowerCase() : 'help'

    switch (command) {
      case 'start':
        if (this.args.help) {
          this.log.info(`Usage: ${this.toolName} start [options]

Description:

Runs 'npm start' in all directories containing 'package.json' except 'node_modules/**'.

Options:
  --actors, -a    If one or more 'actor:*' scripts are found in the package.json,
                  run those instead of the 'start' script, if it exists.
`)
          return 0
        }
        this.startAll(project)
        break
      case 'build':
        if (this.args.help) {
          this.log.info(`Usage: ${this.toolName} build

Description:

Runs 'npm run build' in all directories containing 'package.json' except 'node_modules/**'.
`)
          return 0
        }
        this.buildAll(project)
        break
      case 'test':
        if (this.args.help) {
          this.log.info(`Usage: ${this.toolName} test

Description:

Runs 'npm test' in all directories containing 'package.json' except 'node_modules/**'.
`)
          return 0
        }
        this.testAll(project)
        break
      case 'release':
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
`)
          return 0
        }
        this.release(project)
        break
      case 'clean':
        if (this.args.help) {
          this.log.info(`Usage: ${this.toolName} clean

Description:

Deletes all 'dist' and 'node_modules' directories, and 'package-lock.json' files recursively.
`)
          return 0
        }
        this.cleanAll(project)
        break
      case 'install':
        if (this.args.help) {
          this.log.info(`Usage: ${this.toolName} install

Description:

Runs 'npm install' in all directories containing 'package.json' except 'node_modules/**'.
`)
          return 0
        }
        this.installAll(project)
        break
      case 'update':
        if (this.args.help) {
          this.log.info(`Usage: ${this.toolName} update

Description:

Runs 'npm update' in all directories containing 'package.json' except 'node_modules/**'.
`)
          return 0
        }
        this.args.packages = this.args._.slice(1)
        this.updateAll(project)
        break
      case 'help':
      default:
        this.log.info(`
Usage: ${this.toolName} <cmd> [options]

Commands:
  start       Run 'npm start' for all projects in new terminal tabs.
              Requires iTerm2 (https://www.iterm2.com/)
  build       Run 'npm build' for all projects
  test        Run 'npm test' for all projects
  update      Run 'npm update <pkg>...' for all projects
  install     Run 'npm install' for all projects
  clean       Remove 'node_modules' and distribution files for all packages
  release     Increment version, build, test, tag and release

Global Options:
  --help                        Shows this help.
  --version                     Shows the tool version.
`)
        return 0
    }

    return 0
  }
}
