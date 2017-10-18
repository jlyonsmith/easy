import glob from 'glob'
import parseArgs from 'minimist'
import chalk from 'chalk'
import { fullVersion } from './version'
import util from 'util'
import toposort from 'toposort'
import fs from 'fs'
import path from 'path'
import process from 'process'
import { exec } from 'child_process'
import tempy from 'tempy'

export class PackageSnap {
  constructor(log) {
    this.log = log
  }

  async getProject() {
    const filenames = await util.promisify(glob)('**/package.json',
      { ignore: ['**/node_modules/**', '**/scratch/**', 'package.json'], realpath: true })
    const dirnames = filenames.map(filename => (path.dirname(filename)))
    const pkgMap = new Map(dirnames.map(dirname => ([dirname, {}])))
    let edges = []

    for (let pair of pkgMap) {
      const [dirname, pkg] = pair
      const json = await util.promisify(fs.readFile)(dirname + '/package.json', { encoding: 'utf8' })
      const obj = JSON.parse(json)
      const prefix = 'file:'

      pkg.obj = obj

      if (obj.dependencies) {
        Object.entries(obj.dependencies).forEach(arr => {
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
      order: toposort.array(dirnames, edges).reverse()
    }
  }

  async startAll(project) {
    const tempFile = tempy.file()
    const rootDir = process.cwd()

    let script = `
    tell application "iTerm"
      tell (create window with default profile)
    `
    project.order.map((dirname, index) => {
      const pkg = project.pkgs.get(dirname)
      const name = path.basename(dirname)
      let color
      if (pkg.keywords && pkg.keywords.includes('library')) {
        dir = dir.substring(0, dir.length - 1)
        color = '0 255 0'
      } else {
        color = '0 198 255'
      }
      if (index == 0) {
        script += `
        tell current session of current tab
          write text "cd ${dirname}; title ${name}; tab-color ${color}; npm start"
        end tell`
      } else {
        script += `
        set newTab to (create tab with default profile)
        tell newTab
          tell current session of newTab
            write text "cd ${dirname}; title ${name}; tab-color ${color}; npm start"
          end tell
        end tell`
      }
    })
    script += `
      end tell
    end tell
    `
    console.log(script)
    await util.promisify(fs.writeFile)(tempFile, script)
    await util.promisify(exec)(`osascript < ${tempFile}`)
  }

  async run(argv) {
    const options = {
      boolean: [ 'help', 'version', 'patch', 'minor', 'major' ],
    }
    let args = parseArgs(argv, options)

    if (args.help) {
      this.log.info(`
usage: snap <cmd> [options]

commands:
  start                         Run 'npm start' for all projects

options:
  --patch | --minor | --major   Release a patch, minor or major version. For 'release' only
`)
      return 0
    }

    if (args.version) {
      this.log.info(`{$fullVersion}`)
      return 0
    }

    const project = await this.getProject()

    await this.startAll(project)

    return 0
  }
}
