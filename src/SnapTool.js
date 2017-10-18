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
  constructor(log) {
    this.log = log
  }

  static ensureCommands(cmds) {
    cmds.forEach(cmd => {
      if (!commandExistsSync(cmd)) {
        throw new Error(`Command '${cmd}' does not exist.  Please install it.`)
      }
    })
  }

  getProject() {
    if (!existsSync('package.json')) {
      throw new Error('The current directory does not contain a package.json file')
    }

    const filenames = globSync('**/package.json',
      { ignore: ['**/node_modules/**', '**/scratch/**'], realpath: true })
    const dirnames = filenames.map(filename => (path.dirname(filename)))
    const pkgMap = new Map(dirnames.map(dirname => ([dirname, {}])))
    let edges = []
    let rootPkg = null

    for (let pair of pkgMap) {
      const [dirname, pkg] = pair
      const content = JSON.parse(readFileSync(dirname + '/package.json', { encoding: 'utf8' }))

      pkg.content = content

      if (dirname === process.cwd()) {
        rootPkg = pkg
      } else if (content.dependencies) {
        const prefix = 'file:'

        Object.entries(content.dependencies).forEach(arr => {
          if (arr[1].startsWith(prefix)) {
            const otherDirname = path.resolve(path.join(dirname, arr[1].substring(prefix.length)))

            if (pkgMap.has(otherDirname)) {
              edges.push([dirname, otherDirname])
            }
          }
        })
      }
    }

    return {
      pkgs: pkgMap,
      order: toposort.array(dirnames, edges).reverse(),
      rootPkg
    }
  }

  startAll(project) {
    SnapTool.ensureCommands(['osascript'])

    const tempFile = tmp.fileSync().name
    const rootDir = process.cwd()

    let script = `
    tell application "iTerm"
      tell (create window with default profile)
    `
    project.order.forEach((dirname, index) => {
      const pkg = project.pkgs.get(dirname)

      // Ignore the root project if it's not the only entry
      if (pkg === project.rootPkg && project.pkgs.size > 1) {
        return
      }

      if (!pkg.content.scripts || !pkg.content.scripts.start) {
        return
      }

      const name = path.basename(dirname)
      let color
      if (pkg.content.keywords && pkg.content.keywords.includes('library')) {
        color = '0 255 0'
      } else {
        color = '0 198 255'
      }
      if (index == 0) {
        script += `
        tell current session of current tab
          write text "cd ${dirname}; title ${name}; tab-color ${color}; npm start"
        end tell
        `
      } else {
        script += `
        set newTab to (create tab with default profile)
        tell newTab
          tell current session of newTab
            write text "cd ${dirname}; title ${name}; tab-color ${color}; npm start"
          end tell
        end tell
        `
      }
    })
    script += `
      end tell
    end tell
    `

    writeFileSync(tempFile, script)
    execSync(`osascript < ${tempFile}`)
  }

  buildAll(project) {
    SnapTool.ensureCommands(['npm'])
    project.order.forEach((dirname, index) => {
      const pkg = project.pkgs.get(dirname)
      const name = path.basename(dirname)

      if (pkg.content.scripts && pkg.content.scripts.build) {
        if (this.args.clean) {
            this.log.info(`Cleaning '${name}'...`)
            removeSync('node_modules')
            removeSync('package-lock.json')
            removeSync('dist')
            this.log.info('Installing Packages...')
            execSync('npm install')
        }

        // Skip build for root project if there are multiple
        if (pkg === project.rootPkg && project.pkgs.size > 1) {
          return
        }

        this.log.info(`Building '${name}'...`)
        execSync('npm run build', { cwd: dirname})
      }
    })
  }

  testAll(project) {
    SnapTool.ensureCommands(['npm'])
    project.order.forEach((dirname, index) => {
      const pkg = project.pkgs.get(dirname)

      // Skip test for root project if there are multiple
      if (pkg === project.rootPkg && project.pkgs.size > 1) {
        return
      }

      if (pkg.content && pkg.content.scripts.build) {
        this.log.info(`Testing '${path.basename(dirname)}'...`)
        execSync(`npm run test`, { cwd: dirname})
      }
    })
  }

  release(project) {
    SnapTool.ensureCommands(['stampver', 'git', 'npx', 'npm'])
    this.log.info('Checking for Uncommitted Changes...')
    try {
      execSync('git diff-index --quiet HEAD --')
    } catch (error) {
      throw new Error('There are uncomitted changes - commit or stash them and try again')
    }

    this.log.info('Pulling...')
    execSync('git pull')
    this.log.info('Building...')
    this.buildAll(project)
    this.log.info('Testing...')
    this.testAll(project)
    this.log.info('Updating Version...')
    ensureDirSync('scratch')

    const incrFlag = this.args.patch ? '-i patch' : this.args.minor ? '-i minor' : this.args.major ? '-i major' : ''

    execSync(`npx stampver ${incrFlag} -u`)
    const tagName = readFileSync('scratch/version.tag.txt')
    const tagDescription = readFileSync('scratch/version.desc.txt')

    this.log.info('Committing Version Changes...')
    execSync(`git add :/`)

    if (this.args.patch || this.args.minor || this.args.major) {
      this.log.info('Tagging...')
      execSync(`git tag -a ${tagName} -m '${tagDescription}'`)
    }

    execSync(`git commit -m '${tagDescription}'`)

    this.log.info('Pushing...')
    execSync('git push --follow-tags')

    if (project.pkgs.size === 1 && !project.rootPkg.content.private) {
      if (!this.args.patch && !this.args.minor && !this.args.major) {
        this.log.error(`Not pushing to NPM as major, minor or patch number must be incremented`)
        return
      }
      this.log.info('Publishing...')
      execSync('npm publish')
    }
  }

  async run(argv) {
    const options = {
      boolean: [ 'help', 'version', 'patch', 'minor', 'major', 'clean' ],
    }
    this.args = parseArgs(argv, options)

    const command = this.args._[0]

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
`)
      return 0
    }

    if (this.args.version) {
      this.log.info(`{$fullVersion}`)
      return 0
    }

    const project = this.getProject()

    switch (command.toLowerCase()) {
      case 'start':
        this.startAll(project)
        break
      case 'build':
        this.buildAll(project)
        break
      case 'test':
        this.testAll(project)
        break
      case 'release':
        this.release(project)
        break
      default:
        this.log.error('Use --help to see available commands')
        return -1
    }

    return 0
  }
}