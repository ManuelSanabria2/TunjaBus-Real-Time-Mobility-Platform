const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SVG_PATH = path.resolve(__dirname, '../Logos-diseño/icon-pasajeros.svg');
const RES_PATH = path.resolve(__dirname, 'android/app/src/main/res');

// Standard launcher icon sizes
const sizes = [
  { dir: 'mipmap-mdpi',    size: 48,  fgSize: 108 },
  { dir: 'mipmap-hdpi',    size: 72,  fgSize: 162 },
  { dir: 'mipmap-xhdpi',   size: 96,  fgSize: 216 },
  { dir: 'mipmap-xxhdpi',  size: 144, fgSize: 324 },
  { dir: 'mipmap-xxxhdpi', size: 192, fgSize: 432 },
];

async function generateIcons() {
  const svgBuffer = fs.readFileSync(SVG_PATH);
  console.log('Generating icons from:', SVG_PATH);

  for (const { dir, size, fgSize } of sizes) {
    const dirPath = path.join(RES_PATH, dir);
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });

    // ic_launcher.png
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(path.join(dirPath, 'ic_launcher.png'));
    console.log(`✓ ${dir}/ic_launcher.png (${size}x${size})`);

    // ic_launcher_round.png
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(path.join(dirPath, 'ic_launcher_round.png'));
    console.log(`✓ ${dir}/ic_launcher_round.png (${size}x${size})`);

    // ic_launcher_foreground.png (adaptive icon foreground - larger canvas)
    await sharp(svgBuffer)
      .resize(fgSize, fgSize)
      .png()
      .toFile(path.join(dirPath, 'ic_launcher_foreground.png'));
    console.log(`✓ ${dir}/ic_launcher_foreground.png (${fgSize}x${fgSize})`);
  }

  console.log('\n✅ All icons generated successfully!');
}

generateIcons().catch(err => {
  console.error('Error generating icons:', err);
  process.exit(1);
});
