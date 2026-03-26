import assert from 'node:assert'
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { x } from 'tar'
import { temporaryFile } from 'tempy'


// find the latest version of @cloudflare/workers-types from npm
const versionResponse = await fetch('https://registry.npmjs.org/@cloudflare/workers-types')
const version = await (versionResponse.json() as Promise<{ 'dist-tags': { latest: string } }>).then(data => data['dist-tags'].latest)
console.log(version)

// fail for other major version so we can manually investigate
assert.strictEqual(version.split('.')[0], '4', 'version should be 4.x.x')

const packageFolder = resolve(import.meta.dirname, '..', '..', 'workers-types')

// download decompress into packages/workers-types
const download = await fetch(`https://registry.npmjs.org/@cloudflare/workers-types/-/workers-types-${version}.tgz`)
const tarballBuffer = await download.arrayBuffer()
const tarball = temporaryFile({ extension: 'tar.gz' })
await writeFile(tarball, new Uint8Array(tarballBuffer))
await mkdir(packageFolder, { recursive: true })
await x({ file: tarball, cwd: packageFolder, strip: 1, 'keep-existing': true })
console.log(packageFolder)

// replace package.json name with "@workers-community/workers-types"
const packageJsonFile = await readFile(resolve(packageFolder, 'package.json'), 'utf8')
const packageJson = JSON.parse(packageJsonFile)
packageJson.name = '@workers-community/workers-types'
packageJson.repository = {
  type: 'git',
  url: 'https://github.com/workers-community/workers-community'
}
packageJson.author = 'Workers Community'

/* FOR FIXES
// bump patch version if already published
const communityPackage = await fetch(`https://registry.npmjs.org/${packageJson.name}`)
if (communityPackage.ok) {
  const { versions } = await communityPackage.json() as { versions: Record<string, unknown | undefined> }
  if (version in versions) {
    const [ major, minor, patch ] = version.split('.').map(Number)
    assert.ok(typeof patch === 'number', 'Invalid package version')
    packageJson.version = `${major}.${minor}.${patch + 1}`
  }
}
*/

// find folder with newest date name
const newestEntrypoint = (await readdir(packageFolder)).filter(file => /^\d{4}-\d{2}-\d{2}/.test(file)).sort((a, b) => {
  const aDate = new Date(a)
  const bDate = new Date(b)

  return bDate.getTime() - aDate.getTime()
})[0]

assert.ok(newestEntrypoint, 'No entrypoint candidates found')
console.log(newestEntrypoint)

packageJson.exports = {
  '.': {
    types: './index.d.ts',
    import: './index.ts'
  }
}

// copy newest entrypoint to root
await copyFile(resolve(packageFolder, newestEntrypoint, 'index.d.ts'), resolve(packageFolder, 'index.d.ts'))
await copyFile(resolve(packageFolder, newestEntrypoint, 'index.ts'), resolve(packageFolder, 'index.ts'))

// add export overrides and remove all entrypoints in folders
for await (const entrypoint of await readdir(packageFolder, { withFileTypes: true })) {
  if (!entrypoint.isDirectory()) {
    continue
  }

  await rm(resolve(packageFolder, entrypoint.name), { recursive: true })

  console.log(entrypoint.name)

  packageJson.exports[`./${entrypoint.name}`] = {
    types: './index.d.ts',
    import: './index.ts'
  }
}

await writeFile(resolve(packageFolder, 'package.json'), JSON.stringify(packageJson, null, 2))
await rm(resolve(packageFolder, 'entrypoints.svg'))
