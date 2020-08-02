const os = require('os');

export default {
    token: '',
    branch: 'master',
    port: 8000,
    localRepo: `${os.homedir()}/.ipfs`,
};
