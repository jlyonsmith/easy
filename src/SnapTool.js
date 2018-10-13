import { sync as globSync } from "glob"
import parseArgs from "minimist"
import { fullVersion } from "./version"
import toposort from "toposort"
import {
  readFileSync,
  writeFileSync,
  removeSync,
  existsSync,
  ensureDirSync,
} from "fs-extra"
import path from "path"
import process from "process"
import { execSync, exec } from "child_process"
import tmp from "tmp"
import { sync as commandExistsSync } from "command-exists"

export class SnapTool {
  constructor(toolName, log) {
    this.toolName = toolName
    this.log = log
  }

  ensureCommands(cmds) {
    this.cmds = this.cmds || new Set()

    cmds.forEach((cmd) => {
      if (!this.cmds.has(cmd) && !commandExistsSync(cmd)) {
        throw new Error(`Command '${cmd}' does not exist.  Please install it.`)
      } else {
        this.cmds.add(cmd)
      }
    })
  }

  getPackageInfo() {
    if (!existsSync("package.json")) {
      throw new Error(
        "The current directory does not contain a package.json file"
      )
    }

    const filenames = globSync("**/package.json", {
      ignore: ["**/node_modules/**", "**/scratch/**"],
      realpath: true,
    })
    const dirNames = filenames.map((filename) => path.dirname(filename))
    const pkgMap = new Map(dirNames.map((dirName) => [dirName, {}]))
    let edges = []
    let rootPkg = null

    for (let pair of pkgMap) {
      const [dirName, pkg] = pair
      const packageFilename = dirName + "/package.json"
      let content = null

      try {
        content = JSON.parse(
          readFileSync(packageFilename, { encoding: "utf8" })
        )
      } catch (error) {
        this.log.error(`Reading ${packageFilename}`)
        throw error
      }

      pkg.content = content

      if (dirName === process.cwd()) {
        rootPkg = pkg
      } else if (content.dependencies) {
        const prefix = "file:"

        Object.entries(content.dependencies).forEach((arr) => {
          if (arr[1].startsWith(prefix)) {
            const otherdirName = path.resolve(
              path.join(dirName, arr[1].substring(prefix.length))
            )

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
      rootPkg,
    }
  }

  startAll(pkgInfo) {
    this.ensureCommands(["osascript"])

    const tmpObjMain = tmp.fileSync()
    const tmpObjHelper = tmp.fileSync()
    const preferActors = !!this.args.actors

    writeFileSync(
      tmpObjHelper.name,
      `# function for setting iTerm2 titles
function title {
  printf "\\x1b]0;%s\\x7" "$1"
}

# function for setting iTerm2 tab colors
function tab-color {
  printf "\\x1b]6;1;bg;red;brightness;%s\\x7" "$1"
  printf "\\x1b]6;1;bg;green;brightness;%s\\x7" "$2"
  printf "\\x1b]6;1;bg;blue;brightness;%s\\x7" "$3"
}
`
    )

    let script = `
tell application "iTerm"
  tell (create window with default profile)
    `
    let firstTab = true

    // Loop through package.json dirs
    pkgInfo.order.forEach((dirName) => {
      const pkg = pkgInfo.pkgs.get(dirName)

      if (!pkg.content.scripts) {
        return
      }

      let tabDetails = []

      if (preferActors) {
        const actorNames = Object.getOwnPropertyNames(
          pkg.content.scripts
        ).filter((s) => s.startsWith("actor:") && !s.endsWith(":debug"))

        if (actorNames.length > 0) {
          tabDetails = actorNames.map((name) => ({
            name,
            title: name.substring("actor:".length),
            color: "255 198 0",
          }))
        }
      }

      if (tabDetails.length === 0) {
        if (!pkg.content.scripts.start) {
          return
        }

        const isLibrary =
          pkg.content.keywords &&
          ((Array.isArray(pkg.content.keywords) &&
            pkg.content.keywords.includes("library")) ||
            pkg.content.keywords.hasOwnProperty("library"))

        tabDetails = [
          {
            name: "start",
            title: path.basename(dirName),
            color: isLibrary ? "0 255 0" : "0 198 255",
          },
        ]
      }

      tabDetails.forEach((detail) => {
        if (firstTab) {
          script += `
    tell current session of current tab
      write text "cd ${dirName}; title ${detail.title}; tab-color ${
            detail.color
          }; npm run ${detail.name}"
    end tell
`
          firstTab = false
        } else {
          script += `
    set newTab to (create tab with default profile)
    tell newTab
      tell current session of newTab
        write text "cd ${dirName}; title ${detail.title}; tab-color ${
            detail.color
          }; npm run ${detail.name}"
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

    writeFileSync(tmpObjMain.name, script)

    if (this.args.debug) {
      this.log.info(script)
    }

    execSync(`source ${tmpObjHelper.name}; osascript < ${tmpObjMain.name}`, {
      shell: "/bin/bash",
    })
  }

  testAll(pkgInfo) {
    this.ensureCommands(["npm"])
    pkgInfo.order.forEach((dirName, index) => {
      const pkg = pkgInfo.pkgs.get(dirName)

      if (pkg.content.scripts && pkg.content.scripts.test) {
        this.log.info2(`Testing '${path.basename(dirName)}'...`)
        execSync(`npm test`, { cwd: dirName })
      }
    })
  }

  cleanAll(pkgInfo) {
    this.ensureCommands(["npm"])

    pkgInfo.order.forEach((dirName, index) => {
      const name = path.basename(dirName)

      this.log.info2(`Cleaning '${name}'...`)
      removeSync(path.join(dirName, "node_modules"))
      removeSync(path.join(dirName, "package-lock.json"))
      removeSync(path.join(dirName, "dist"))
      removeSync(path.join(dirName, "build"))
    })
  }

  installAll(pkgInfo) {
    this.ensureCommands(["npm"])

    if (this.args.clean) {
      this.cleanAll(pkgInfo)
    }

    pkgInfo.order.forEach((dirName, index) => {
      const pkg = pkgInfo.pkgs.get(dirName)
      const name = path.basename(dirName)

      this.log.info2(`Installing modules in '${name}'...`)
      execSync(`npm install`, { cwd: dirName })
    })
  }

  updateAll(pkgInfo) {
    this.ensureCommands(["npm"])

    pkgInfo.order.forEach((dirName, index) => {
      const pkg = pkgInfo.pkgs.get(dirName)
      const name = path.basename(dirName)

      this.args.packages.forEach((pkgName) => {
        if (
          (pkg.content.dependencies && pkg.content.dependencies[pkgName]) ||
          (pkg.content.devDependencies && pkg.content.devDependencies[pkgName])
        ) {
          this.log.info2(`Update '${pkgName}' in '${name}'...`)
          execSync(`npm update ${pkgName}`, { cwd: dirName })
        }
      })
    })
  }

  buildAll(pkgInfo) {
    this.ensureCommands(["npm"])

    if (this.args.install) {
      this.installAll(pkgInfo)
    }

    pkgInfo.order.forEach((dirName, index) => {
      const pkg = pkgInfo.pkgs.get(dirName)
      const name = path.basename(dirName)

      if (pkg.content.scripts && pkg.content.scripts.build) {
        this.log.info2(`Building '${name}'...`)
        execSync("npm run build", { cwd: dirName })
      }
    })
  }

  deployAll(pkgInfo) {
    this.ensureCommands(["npm"])

    const internalExec = (command, options) => {
      return new Promise((resolve, reject) => {
        const cp = exec(command, options)

        cp.stdout.on("data", (data) => {
          const s = data.toString().trim()

          if (this.args.ansible) {
            if (s.startsWith("ok: ")) {
              this.log.ansibleOK(s)
            } else if (s.startsWith("changed: ")) {
              this.log.ansibleChanged(s)
            } else if (s.startsWith("skipping: ")) {
              this.log.ansibleSkipping(s)
            } else if (s.startsWith("error: ")) {
              this.log.ansibleError(s)
            } else {
              this.log.info(s)
            }
          } else {
            this.log.info(s)
          }
        })

        cp.stderr.on("data", (data) => {
          this.log.error(data.toString().trim())
        })

        cp.on("error", () => {
          reject()
        })

        cp.on("exit", function(code) {
          if (code !== 0) {
            reject()
          } else {
            resolve()
          }
        })
      })
    }

    pkgInfo.order.forEach((dirName, index) => {
      const pkg = pkgInfo.pkgs.get(dirName)
      const name = path.basename(dirName)

      if (pkg.content.scripts && pkg.content.scripts.deploy) {
        this.log.info2(`Deploying '${name}'...`)
        internalExec("npm run deploy", {
          cwd: dirName,
        })
      }
    })
  }

  releaseAll(pkgInfo) {
    this.ensureCommands(["stampver", "git", "npx", "npm"])

    if (!this.args.patch && !this.args.minor && !this.args.major) {
      this.log.warning(
        `Major, minor or patch number must be incremented for release`
      )
      return
    }

    pkgInfo.order.forEach((dirName, index) => {
      const pkg = pkgInfo.pkgs.get(dirName)
      const name = path.basename(dirName)

      this.log.info2(`Releasing '${name}'...`)

      this.log.info2("Checking for Uncommitted Changes...")
      try {
        execSync("git diff-index --quiet HEAD --")
      } catch (error) {
        throw new Error(
          "There are uncomitted changes - commit or stash them and try again"
        )
      }

      this.log.info2("Pulling...")
      execSync("git pull")

      this.log.info2("Updating Version...")
      ensureDirSync("scratch")

      const incrFlag = this.args.patch
        ? "-i patch"
        : this.args.minor
          ? "-i minor"
          : this.args.major
            ? "-i major"
            : ""

      execSync(`npx stampver ${incrFlag} -u -s`)
      const tagName = readFileSync("scratch/version.tag.txt")
      const tagDescription = readFileSync("scratch/version.desc.txt")

      try {
        this.log.info2("Installing...")
        this.installAll(pkg)
        this.log.info2("Building...")
        this.buildAll(pkg)
        this.log.info2("Testing...")
        this.testAll(pkg)

        this.log.info2("Committing Version Changes...")
        execSync("git add :/")

        if (this.args.patch || this.args.minor || this.args.major) {
          this.log.info2("Tagging...")
          execSync(`git tag -a ${tagName} -m '${tagDescription}'`)
        }

        execSync(`git commit -m '${tagDescription}'`)
      } catch (error) {
        // Roll back version changes if anything went wrong
        execSync("git checkout -- .")
        return
      }

      this.log.info2("Pushing to Git...")
      execSync("git push --follow-tags")

      if (
        this.args.npm &&
        pkgInfo.pkgs.size >= 1 &&
        !pkgInfo.rootPkg.content.private
      ) {
        this.log.info2("Publishing to NPM...")
        execSync("npm publish")
      }
    })

    if (!this.args.npm && this.args.deploy) {
      this.deployAll(pkgInfo)
    }
  }

  async run(argv) {
    const options = {
      boolean: [
        "help",
        "version",
        "patch",
        "minor",
        "major",
        "clean",
        "install",
        "actors",
        "npm",
        "debug",
        "ansible",
      ],
      alias: {
        a: "actors",
      },
    }
    this.args = parseArgs(argv, options)

    if (this.args.version) {
      this.log.info(`${fullVersion}`)
      return 0
    }

    const pkgInfo = this.getPackageInfo()
    let command = this.args._[0]

    command = command ? command.toLowerCase() : "help"

    switch (command) {
      case "start":
        if (this.args.help) {
          this.log.info(`Usage: ${this.toolName} start [options]

Description:

Recursively runs 'npm start' in all directories containing 'package.json' except 'node_modules/**'.

Options:
  --actors, -a    If one or more 'actor:*' scripts are found in the package.json,
                  run those instead of the 'start' script, if it exists.
`)
          return 0
        }
        this.startAll(pkgInfo)
        break

      case "build":
        if (this.args.help) {
          this.log.info(`Usage: ${this.toolName} build

Description:

Recursively runs 'npm run build' in all directories containing 'package.json' except 'node_modules/**'.

Options:
  --install       Recursively runs 'npm install' before building
  --clean         If '--install' is specified, does a 'clean' first
`)
          return 0
        }
        this.buildAll(pkgInfo)
        break

      case "deploy":
        if (this.args.help) {
          this.log.info(`Usage: ${this.toolName} deploy

Description:

Recursively runs 'npm run deploy' in all directories containing 'package.json' except 'node_modules/**'.

Options:
  --ansible     Colorize Ansible output if detected

`)
          return 0
        }
        this.deployAll(pkgInfo)
        break

      case "test":
        if (this.args.help) {
          this.log.info(`Usage: ${this.toolName} test

Description:

Recursively runs 'npm test' in all directories containing 'package.json' except 'node_modules/**'.
`)
          return 0
        }
        this.testAll(pkgInfo)
        break

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
  --deploy      Run a deployment after a success release. Cannot be used with --npm.
`)
          return 0
        }
        this.releaseAll(pkgInfo)
        break

      case "clean":
        if (this.args.help) {
          this.log.info(`Usage: ${this.toolName} clean

Description:

Recursively deletes all 'dist' and 'node_modules' directories, and 'package-lock.json' files.
`)
          return 0
        }
        this.cleanAll(pkgInfo)
        break

      case "install":
        if (this.args.help) {
          this.log.info(`Usage: ${this.toolName} install

Description:

Recursively runs 'npm install' in all directories containing 'package.json' except 'node_modules/**'.
`)
          return 0
        }
        this.installAll(pkgInfo)
        break

      case "update":
        if (this.args.help) {
          this.log.info(`Usage: ${this.toolName} update

Description:

Recursively runs 'npm update' in all directories containing 'package.json' except 'node_modules/**'.
`)
          return 0
        }
        this.args.packages = this.args._.slice(1)
        this.updateAll(pkgInfo)
        break

      case "help":
      default:
        this.log.info(`
Usage: ${this.toolName} <cmd> [options]

Description:

By default, operates on all packages from the current directory recursively.

Commands:
  start       Run 'npm start' in new terminal tabs.
              Requires iTerm2 (https://www.iterm2.com/)
  build       Run 'npm run build'
  deploy      Run 'npm run deploy'
  test        Run 'npm test'
  update      Run 'npm update <pkg>...'
  install     Run 'npm install'
  clean       Remove 'node_modules' and distribution files
  release     Increment version, build, test, tag and release

Global Options:
  --help                        Shows this help
  --version                     Shows the tool version
  --debug                       Enable debugging output
  --no-recurse                  Don't recursive up the directory tree
`)
        return 0
    }

    return 0
  }
}
