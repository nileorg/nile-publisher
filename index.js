const config = require('./publisher.config')

const express = require('express')
const bodyParser = require('body-parser');
const simpleGit = require('simple-git');

const fs = require('fs');
const fsExtra = require('fs-extra')
const path = require('path')
const IPFS = require('ipfs');
const fetch = require('node-fetch');

const nileClientDir = path.join(__dirname, 'tmp/nile-client-lite');

const nileRepositoryDir = path.join(__dirname, 'tmp/nile-repository');
const citiesDir = path.join(nileRepositoryDir, 'cities');
const citiesFile = path.join(nileRepositoryDir, 'cities.json');

const getCities = () => {
  const buffer = fs.readFileSync(citiesFile);
  return JSON.parse(buffer.toString('utf-8'));
};

const getStores = (cityUid) => {
  const buffer = fs.readFileSync(path.join(citiesDir, cityUid, 'stores.json'));
  return JSON.parse(buffer.toString('utf-8'));
};

const publishRepository = async () => {

  const ipfsNode = await IPFS.create();

  const addToIpfs = async (filename) => {
    if (!filename.startsWith(__dirname)) {
      throw new Error(`Invalid path: ${filename} is not in ${__dirname}`);
    }
    const ipfsPath = filename.slice(__dirname.length);
    const { cid } = await ipfsNode.add({
      path: ipfsPath,
      content: fs.readFileSync(filename),
    });
    const link = cid.toString();
    console.info(`✅ Added ${ipfsPath}: ${link}`);
    return link;
  };

  const addStore = async (cityUid, store) => {
    const { uid } = store;
    const link = await addToIpfs(path.join(citiesDir, cityUid, 'stores', `${uid}.json`));
    return { ...store, link };
  };

  let succeeding = true

  try {

    await simpleGit().clone('git@github.com:nileorg/nile-repository.git', './tmp/nile-repository')
    
    const citiesWithLinksPromises = getCities().map(async (city) => {
      const { uid: cityUid } = city;
      const storesWithLinksPromises = getStores(cityUid).map(store => addStore(cityUid, store));
      const storesWithLinks = await Promise.all(storesWithLinksPromises);
      const storesWithLinksJson = JSON.stringify(storesWithLinks);
      fs.writeFileSync(path.join(citiesDir, cityUid, 'stores.json'), storesWithLinksJson);

      const link = await addToIpfs(path.join(citiesDir, cityUid, 'stores.json'));
      return { ...city, link };
    });

    const citiesWithLinks = await Promise.all(citiesWithLinksPromises);
    const citiesWithLinksJson = JSON.stringify(citiesWithLinks);
    const citiesFilename = citiesFile;
    fs.writeFileSync(citiesFilename, citiesWithLinksJson);
    const citiesLink = await addToIpfs(citiesFilename);

    console.log(`📥 Cloning repo...`)
    await simpleGit().clone('git@github.com:nileorg/nile-client-lite.git', nileClientDir)
    console.log(`✅ Repo cloned!`)
    await simpleGit(nileClientDir).checkout(config.branch)
    console.log(`✅ Repo switched to ${config.branch}!`)

    await fsExtra.outputFile(nileClientDir + '/src/hash.js', `export default '${citiesLink}';`)
    
    console.log(`📤 Publishing the new hash...`)
    await simpleGit(nileClientDir)
      .add('./*')
      .commit("update hash")
      .push('origin', config.branch)
    console.log(`✅ New hash published!`)

  } catch (error) {
    console.error(error);
    succeeding = false;
  } finally {
    fsExtra.emptyDirSync('./tmp')
    ipfsNode.stop();
    return succeeding;
  }
}

const app = express()
app.use(bodyParser.json());

app.use(function (req, res, next) {
  if (req.headers.authorization != config.token) {
    return res.status(403).send()
  }
  next();
})

app.post('/publish', async function (req, res) {
  if (await publishRepository()) {
    console.log(`✅ Success`)
    return res.status(200).send()
  } else {
    return res.status(500).send()
  }
})

app.listen(config.port)