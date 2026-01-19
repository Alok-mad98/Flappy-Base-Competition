import https from 'https';
import fs from 'fs';
import path from 'path';

const assetsDir = path.join(process.cwd(), 'public', 'assets');

if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
}

const assets = [
    { name: 'bird.png', url: 'https://raw.githubusercontent.com/samuelcust/flappy-bird-assets/master/sprites/bluebird-midflap.png' },
    { name: 'pipe.png', url: 'https://raw.githubusercontent.com/samuelcust/flappy-bird-assets/master/sprites/pipe-green.png' },
    { name: 'bg.png', url: 'https://raw.githubusercontent.com/samuelcust/flappy-bird-assets/master/sprites/background-night.png' },
    { name: 'base.png', url: 'https://raw.githubusercontent.com/samuelcust/flappy-bird-assets/master/sprites/base.png' }
];

const download = (url, dest) => {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download ${url}: ${response.statusCode}`));
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                console.log(`Downloaded: ${dest}`);
                resolve();
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => {});
            reject(err);
        });
    });
};

async function run() {
    console.log('Starting asset download...');
    for (const asset of assets) {
        const dest = path.join(assetsDir, asset.name);
        try {
            await download(asset.url, dest);
        } catch (err) {
            console.error(err.message);
        }
    }
    console.log('Asset download complete.');
}

run();
