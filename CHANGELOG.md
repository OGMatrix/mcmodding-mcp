## [0.3.1](https://github.com/OGMatrix/mcmodding-mcp/compare/v0.3.0...v0.3.1) (2025-12-23)

### Bug Fixes

* handle HTTP redirects in fetchJson for GitHub release assets ([9b0bbef](https://github.com/OGMatrix/mcmodding-mcp/commit/9b0bbef2f495d0260cefc6bc7d8d2791960a31d3))

## [0.3.0](https://github.com/OGMatrix/mcmodding-mcp/compare/v0.2.2...v0.3.0) (2025-12-21)

### Features

* improved searching ([214a308](https://github.com/OGMatrix/mcmodding-mcp/commit/214a308413022ecec88c9f4ad98908a90349c4cc))
* improved versioning and managing and made db version independent ([c5a8a94](https://github.com/OGMatrix/mcmodding-mcp/commit/c5a8a942c468af1fb144e274cae394f27807c315))

### Bug Fixes

* fixed flickering, upgraded manage command and renamed it from "install" ([fff1578](https://github.com/OGMatrix/mcmodding-mcp/commit/fff15781377eac5d4e453644dbdcad50eb8e6cc3))

### CI/CD

* disable LFS fetch in workflows to save bandwidth ([33dd7fe](https://github.com/OGMatrix/mcmodding-mcp/commit/33dd7fe6e89f91e680c41e7423930f94a94f620c))

## [0.2.2](https://github.com/OGMatrix/mcmodding-mcp/compare/v0.2.1...v0.2.2) (2025-12-17)

### Bug Fixes

* downgrade semantic-release to support node 20 ([ee71928](https://github.com/OGMatrix/mcmodding-mcp/commit/ee71928bbbaeab7d59da4c4ad86ef42d19a40d9a))
* setup docker build and version automation ([47bb1e4](https://github.com/OGMatrix/mcmodding-mcp/commit/47bb1e42f71d5994cdb6c61ebaa5245c1a89eb5c))
* update semantic-release to resolve peer dependency conflict ([b31c18c](https://github.com/OGMatrix/mcmodding-mcp/commit/b31c18c5264f692eee1d70ac8aea1fac66475489))

## [0.2.1](https://github.com/OGMatrix/mcmodding-mcp/compare/v0.2.0...v0.2.1) (2025-12-16)

### Bug Fixes

* prevent build:prod from deleting data folder ([4b22d33](https://github.com/OGMatrix/mcmodding-mcp/commit/4b22d3323579d767f49d000331c8fd7ae4c40117))

## [0.2.0](https://github.com/OGMatrix/mcmodding-mcp/compare/v0.1.4...v0.2.0) (2025-12-16)

### Features

* switch from release-please to semantic-release ([84b5204](https://github.com/OGMatrix/mcmodding-mcp/commit/84b52046d522329a0ba21e1ec81139ba6a5dfaeb))
* update ([9644179](https://github.com/OGMatrix/mcmodding-mcp/commit/964417976d24e4e79fcaa15bb080450e16ce7be8))

### Bug Fixes

* configure semantic-release to skip npm publish ([56f9fd9](https://github.com/OGMatrix/mcmodding-mcp/commit/56f9fd98ba4c78985d064611091dee82dd63c2c7))
* sync versions to 0.1.4 ([19f37a1](https://github.com/OGMatrix/mcmodding-mcp/commit/19f37a10f12184192e53115d803417c9d8cc7f51))

### Build System

* upgrade semantic-release to v24 ([645c5d3](https://github.com/OGMatrix/mcmodding-mcp/commit/645c5d32dd44151687e7ee7f09d9adb163153523))

### CI/CD

* enable git lfs in checkout to fix release push ([dbc0792](https://github.com/OGMatrix/mcmodding-mcp/commit/dbc0792e2a62057a678291096d4262713638b0a6))
* trigger release after lfs push ([5418db8](https://github.com/OGMatrix/mcmodding-mcp/commit/5418db88996c37abb204d1ae1bbf7c12d06206cf))
* use GH_TOKEN for semantic-release authentication ([e04afd9](https://github.com/OGMatrix/mcmodding-mcp/commit/e04afd94b5b1c254cd9c98e1cd588a85a32d284c))

# Changelog

## [0.1.0](2025-12-14)


### ✨ Features

* added github workflows ([2533b29](https://github.com/OGMatrix/mcmodding-mcp/commit/2533b29365b6eec0c706e66353755efce1becfee))
* added github workflows ([2533b29](https://github.com/OGMatrix/mcmodding-mcp/commit/2533b29365b6eec0c706e66353755efce1becfee))
* added github workflows ([3c19306](https://github.com/OGMatrix/mcmodding-mcp/commit/3c193065d1d373a83c2eab32ac9091cb0643ef2e))


### 🐛 Bug Fixes

* fixed category extraction to be universal ([2dad952](https://github.com/OGMatrix/mcmodding-mcp/commit/2dad95246214883f41f444777c2a82c54e6e85fc))
* fixed lint errors ([be0558f](https://github.com/OGMatrix/mcmodding-mcp/commit/be0558f8c46d909c8adab27f4277597cf4c18486))
* fixed linter errors ([bad07df](https://github.com/OGMatrix/mcmodding-mcp/commit/bad07dfd2def229554b1463e8d63904cff670e22))
* fixed node version ([fde0987](https://github.com/OGMatrix/mcmodding-mcp/commit/fde0987695a11556f702b095d132715109520dba))
* fixed non null assertion ([63c9c04](https://github.com/OGMatrix/mcmodding-mcp/commit/63c9c04741087cd0692074b597bebcd2795d5790))
* fixed release please workflow ([83f8ec2](https://github.com/OGMatrix/mcmodding-mcp/commit/83f8ec27d21d75c1101964f7128b3e53b26506cf))
* fixed release-please workflow ([ccd8750](https://github.com/OGMatrix/mcmodding-mcp/commit/ccd87505c46c85ab3dd52f3b37820f4b5b00f304))
* fixed tests ([3ed0ca6](https://github.com/OGMatrix/mcmodding-mcp/commit/3ed0ca67d84b4003b3aab6baef5a96608906ed44))
* fixed workflow ([e925548](https://github.com/OGMatrix/mcmodding-mcp/commit/e925548275764097045764fb30f3d8bc584cdc38))
* removed db from npm upload because its too large ([c6fb9b3](https://github.com/OGMatrix/mcmodding-mcp/commit/c6fb9b3b7c05cd5df822e9230d4255b56f73066a))


### 🔧 Maintenance

* added mcp init ([8ce8be1](https://github.com/OGMatrix/mcmodding-mcp/commit/8ce8be160e81cb161f7ad6ea38ad5dae1175e90f))
