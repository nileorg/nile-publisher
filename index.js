const config = require('./publisher.config')

const express = require('express')
const bodyParser = require('body-parser');
const simpleGit = require('simple-git');
const git = simpleGit();

const fs = require('fs');
const path = require('path')
const IPFS = require('ipfs');
const fetch = require('node-fetch');

const citiesDir = path.join(__dirname, 'cities');

const getCities = () => {
  const buffer = fs.readFileSync(path.join(__dirname, 'cities.json'));
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

  let succeeding = true;

  try {
    const citiesWithLinksPromises = getCities().map(async (city) => {
      const { uid: cityUid } = city;
      const storesWithLinksPromises = getStores(cityUid).map(store => addStore(cityUid, store));
      const storesWithLinks = await Promise.all(storesWithLinksPromises);
      const storesWithLinksJson = JSON.stringify(storesWithLinks);
      fs.writeFileSync(path.join(citiesDir, cityUid, 'stores.json'), storesWithLinksJson);

      const link = await addToIpfs(path.join(__dirname, 'cities', cityUid, 'stores.json'));
      return { ...city, link };
    });

    const citiesWithLinks = await Promise.all(citiesWithLinksPromises);
    const citiesWithLinksJson = JSON.stringify(citiesWithLinks);
    const citiesFilename = path.join(__dirname, 'cities.json');
    fs.writeFileSync(citiesFilename, citiesWithLinksJson);
    const citiesLink = await addToIpfs(citiesFilename);

    // TODO: Publish on git: check https://www.npmjs.com/package/simple-git

  } catch (error) {
    console.error(error);
    succeeding = false;
  } finally {
    ipfsNode.stop();
    return succeeding;
  }
}

const app = express()
app.use(bodyParser.json());

app.post('/publish', function (req, res) {
  if (publishRepository()) {
    return res.status(200).send()
  } else {
    return res.status(500).send()
  }
})