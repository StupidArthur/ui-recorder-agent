const { execFile } = require('child_process');
const ffmpeg = require('ffmpeg-static');

function run(args) {
  return new Promise((resolve, reject) => {
    execFile(ffmpeg, args, { maxBuffer: 1 << 26 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });
}

async function toMp4(input, output) {
  try {
    await run([
      '-y', '-i', input,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      output,
    ]);
  } catch (e) {
    await run([
      '-y', '-i', input,
      '-c:v', 'mpeg4', '-q:v', '3', '-pix_fmt', 'yuv420p',
      output,
    ]);
  }
  return output;
}

module.exports = { toMp4 };

if (require.main === module) {
  const [, , input, output] = process.argv;
  if (!input || !output) {
    console.error('usage: node src/to-mp4.js <input.webm> <output.mp4>');
    process.exit(1);
  }
  toMp4(input, output).then((o) => console.log('✔ ' + o)).catch((e) => { console.error(e); process.exit(1); });
}
