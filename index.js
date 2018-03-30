const fs = require('mz/fs');
const http = require('http');
const {Readable} = require('stream');
const colors = require('colors/safe');
const url = require('url');
const path = require('path');
const config = require('./config');

const FRAMES_ROOT_DIRECTORY = './frames';
const cachedFrames = {};

const colorsOptions = ['red', 'yellow', 'green', 'blue', 'magenta', 'cyan', 'white'];
const numColors = colorsOptions.length;

const streamer = (stream, frames) => {
  let index = 0;
  let lastColor = -1;
  let newColor = 0;
  return setInterval(() => {
    if (index >= frames.length) index = 0; stream.push('\033[2J\033[H');

    newColor = Math.floor(Math.random() * numColors);

    // Reroll for a new color if it was the same as last frame
    if(newColor == lastColor) {
      newColor += (1 + Math.floor(Math.random() * (numColors - 1)));
      newColor %= numColors;
    }

    lastColor = newColor;
    stream.push(colors[colorsOptions[newColor]](frames[index]));

    index++;
  }, 70);
}

const getAvailablePaths = async () => {
  let availablePaths = await fs.readdir(FRAMES_ROOT_DIRECTORY) || [];

  const statObjects = await Promise.all(availablePaths.map((file) => {
    return fs.lstat(path.join(FRAMES_ROOT_DIRECTORY, file));
  }));

  availablePaths = availablePaths.filter((file, index) => {
    return statObjects[index].isDirectory();
  });
  return availablePaths;
};

const getResourceFromRequest = (req) => {
  let resource = '';
  const pathname = url.parse(req.url).pathname;
  const matchedResource = /^\/([^\/]*)/.exec(pathname);

  if (matchedResource instanceof Array && matchedResource.length > 1) {
    resource = matchedResource[1];
  }

  return resource;
};

const getFrames = async (frameSet) => {
  let frames = [];

  const frameSetRoot = path.join(FRAMES_ROOT_DIRECTORY, frameSet);
  let frameSetFiles = await fs.readdir(frameSetRoot);

  frameSetFiles.sort((a, b) => {
    a = parseInt(a);
    b = parseInt(b);
    return (a < b) ? -1 : ((a > b) ? 1 : 0);
  });

  const statObjects = await Promise.all(frameSetFiles.map((file) => {
    return fs.lstat(path.join(frameSetRoot, file));
  }));

  frameSetFiles = frameSetFiles.filter((file, index) => {
    return statObjects[index].isFile() && !isNaN(parseInt(file));
  });

  for (let file of frameSetFiles) {
    const f = await fs.readFile(path.join(frameSetRoot, file));
    frames.push(f.toString());
  }

  return frames;
};

const server = http.createServer(async (req, res) => {
  if (req.headers && req.headers['user-agent'] && !req.headers['user-agent'].includes('curl')) {
    res.writeHead(302, {'Location': 'https://github.com/hugomd/parrot.live'});
    return res.end();
  }

  let resource = getResourceFromRequest(req);
  const availableFrameSets = await getAvailablePaths();
  if (resource === 'list') {
     return res.end(JSON.stringify(availableFrameSets, null, 4));
  }

  if (resource === '') {
    resource = config.defaultFrameSet;
  }

  if (availableFrameSets.indexOf(resource) === -1) {
    res.writeHead(404);
    return res.end('Not found');
  }

  if (!cachedFrames.hasOwnProperty(resource)) {
    cachedFrames[resource] = await getFrames(resource);
  }

  const frames = cachedFrames[resource];
  if (!frames.length) {
    res.end(`No frames found for frameset ${resource}`);
  }

  const stream = new Readable();
  stream._read = function noop () {};
  stream.pipe(res);
  const interval = streamer(stream, frames);

  req.on('close', () => {
    stream.destroy();
    clearInterval(interval);
  });
});


const port = process.env.PARROT_PORT || 3000;
server.listen(port, err => {
  if (err) throw err;
  console.log(`Listening on locahost:${port}`);
});
