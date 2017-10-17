import glob from 'glob'
import parseArgs from 'minimist'
import chalk from 'chalk'
import { fullVersio } from './version'

class PkgSnap {
  async getPackages() {
    const files = await glob('**/package.json', { ignore: '**/node_modules/**', realpath: true })
  }

  async run(argv) {
    const options = {
      boolean: [ 'help', 'version', 'patch', 'minor', 'major' ],
    }
    let args = parseArgs(argv, options)

    if (args.help) {
      this.log.info(`
usage: tmr-message [options] <file>

options:
  --patch | --minor | --major   Release a patch, minor or major version.
`)
      return 0
    }

    if (args.version) {
      this.log.info(`{$fullVersion}`)
      return 0
    }

    const pkgs = await getPackages()

    this.log.info(pkgs)

    return 0
  }
}
