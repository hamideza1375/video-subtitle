const fs = require("fs");
const express = require("express");
const app = express();
const fileUpload = require("express-fileupload");
const setHeaders = require("./header");
const RootPath = require("app-root-path");

//! download models
//! Sox set to envaironment
//! npx node@14.0.0 ./index.js
const DeepSpeech = require('deepspeech');
const Sox = require('sox-stream');
const MemoryStream = require('memory-stream');
const Duplex = require('stream').Duplex;
const Wav = require('node-wav');
const rootPath = require('app-root-path');
const { execSync } = require('child_process');
const ffmpegStatic = require('ffmpeg-static');
// const { translate } = require('@vitalets/google-translate-api');
const translate = require('./translate');



app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(setHeaders);
app.use(express.static("public"));
app.use(fileUpload());


let modelPath = './models/deepspeech-0.9.3-models.pbmm';

let model = new DeepSpeech.Model(modelPath);

let desiredSampleRate = model.sampleRate();

let scorerPath = './models/deepspeech-0.9.3-models.scorer';

model.enableExternalScorer(scorerPath);



app.get('/t',(req,res)=>{
  res.sendFile(`${RootPath}/public/client/index.html`)
})



const seconder = (secound) => {
  var countDownDate = (secound * 1000)
  var minutes = Math.floor((countDownDate % (1000 * 60 * 60)) / (1000 * 60));
  var seconds = Math.floor((countDownDate % (1000 * 60)) / 1000);
  return { part1: '00:' + String(minutes) + ':' + String(seconds) }
}

var time = 1000
app.post('/upload', async (req, res) => {
  time = 1000
  let s = 0, int
  if (!req.files) return res.status(400).json('err')
  const video = req.files.video;
  const fileName = `${Date.now()}_.${video.name.split('.')[video.name.split('.').length - 1]}`;
  fs.writeFileSync(`${RootPath}/public/upload/${fileName}`, video.data);

  execSync(`${ffmpegStatic} -ss 00:00:00 -i ${RootPath}/public/upload/${fileName} -t 00:01:00 -c copy -f mp4 ${RootPath}/public/upload/${fileName}1.mp4`)
  const { subtitle, audioUrl } = await createSubtitle(`${RootPath}/public/upload/${fileName}1.mp4`, Date.now())
  fs.unlinkSync(`${RootPath}/public/upload/${fileName}1.mp4`)
  fs.unlinkSync(`${RootPath}/public/upload/${fileName}1.mp4.wav`)

  int = setInterval(async () => {
    s += 60
    time = 38000
    if (req.body.duration > (s)) {
      const { part1 } = seconder(s)
      execSync(`${ffmpegStatic} -ss ${part1} -i ${RootPath}/public/upload/${fileName} -t 00:01:00 -c copy -f mp4 ${RootPath}/public/upload/${fileName}.${s}.mp4`)
      await createSubtitle(`${RootPath}/public/upload/${fileName}.${s}.mp4`, audioUrl + '.' + s)
      fs.existsSync(`${RootPath}/public/upload/${fileName}.${s - 60}.mp4`) && fs.unlinkSync(`${RootPath}/public/upload/${fileName}.${s - 60}.mp4`)
      fs.existsSync(`${RootPath}/public/upload/${fileName}.${s - 60}.mp4.wav`) && fs.unlinkSync(`${RootPath}/public/upload/${fileName}.${s - 60}.mp4.wav`)
    }

    if (req.body.duration < (s)) {
      clearInterval(int)
      fs.existsSync(`${RootPath}/public/upload/${fileName}.${s}.mp4`) && fs.unlinkSync(`${RootPath}/public/upload/${fileName}.${s}.mp4`)
      fs.existsSync(`${RootPath}/public/upload/${fileName}.${s}.mp4.wav`) && fs.unlinkSync(`${RootPath}/public/upload/${fileName}.${s}.mp4.wav`)
      fs.existsSync(`${RootPath}/public/upload/${fileName}.${30}.mp4`) && fs.unlinkSync(`${RootPath}/public/upload/${fileName}.${30}.mp4`)
      fs.existsSync(`${RootPath}/public/upload/${fileName}.${30}.mp4.wav`) && fs.unlinkSync(`${RootPath}/public/upload/${fileName}.${30}.mp4.wav`)
      fs.existsSync(`${RootPath}/public/upload/${fileName}`) && fs.unlinkSync(`${RootPath}/public/upload/${fileName}`)
    }
  }, time);
  time = 38000

  res.status(200).json({ text: subtitle, audioUrl, videoUrl: fileName })
})


const port = 4000
app.listen(port, (err) => { console.log(`App Listen to port ${port}`) })







async function createSubtitle(url, fileName) {
  return new Promise((resolve, reject) => {

    let audioFile = transcribeLocalVideo(url)

    if (!fs.existsSync(audioFile)) {
      console.log('file missing:', audioFile);
      process.exit();
    }

    const buffer = fs.readFileSync(audioFile);
    const result = Wav.decode(buffer);

    if (result.sampleRate < desiredSampleRate) {
      console.error('Warning: original sample rate (' + result.sampleRate + ') is lower than ' + desiredSampleRate + 'Hz. Up-sampling might produce erratic speech recognition.');
    }

    function bufferToStream(buffer) {
      let stream = new Duplex();
      stream.push(buffer);
      stream.push(null);
      return stream;
    }

    let audioStream = new MemoryStream();
    bufferToStream(buffer).
      pipe(Sox({
        global: {
          'no-dither': true,
        },
        output: {
          bits: 16,
          rate: desiredSampleRate,
          channels: 1,
          encoding: 'signed-integer',
          endian: 'little',
          compression: 0.0,
          type: 'raw'
        }
      })).
      pipe(audioStream);

    audioStream.on('finish', async () => {
      let audioBuffer = audioStream.toBuffer();
      const audioLength = (audioBuffer.length / 2) * (1 / desiredSampleRate);
      console.log('audio length', audioLength);
      let result = model.stt(audioBuffer);
      const { text } = await translate(result, { to: 'fa' });
      // const { text } = await translate(result, { to: 'fa' })

      const txt = fileName + '.txt'
      fs.writeFileSync(`${rootPath}/public/upload/${txt}`, text);
      const wav = fileName + '.wav'
      // execSync(`espeak-ng -v fa+m3 -f ${rootPath}/test.txt -s 150 -p 15 -a 110 -w ${rootPath}/public/upload/${wav}`)
      execSync(`espeak-ng -v fa+f5 -f ${rootPath}/public/upload/${txt} -s 144 -p 50 -a 90 -w ${rootPath}/public/upload/${wav}`)

      resolve({ subtitle: text, audioUrl: wav, audioLength })
    });
  })
}





function transcribeLocalVideo(filePath) {
  ffmpeg(`-hide_banner -y -i ${filePath} ${filePath}.wav`);
  return `${filePath}.wav`
}




async function ffmpeg(command) {
  // execSync(`${ffmpegStatic} -ss 00:00:00 -i "C:\Input.mp4" -t 00:03:00 -c copy -f mp4 "C:\output.mp4"`)
  return new Promise((resolve, reject) => {
    execSync(`${ffmpegStatic} ${command}`, (err, stderr, stdout) => {
      if (err) reject(err);
      resolve(stdout);
    });
  });
}