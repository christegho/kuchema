import { chromium } from 'playwright';
import fs from 'node:fs/promises';
await fs.mkdir('test-results',{recursive:true});
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1100},deviceScaleFactor:1});
  page.on('pageerror',e=>console.log('PAGE ERROR:',e.message));
  await page.goto('http://127.0.0.1:3000');
  await page.getByRole('heading',{name:'Make a place. Leave the seams.'}).waitFor();
  await page.getByText('Saved locally',{exact:true}).waitFor();
  await page.screenshot({path:'test-results/studio-desktop.png',fullPage:true});
  console.log('Title:',await page.title());
  console.log('Canvas count:',await page.locator('canvas').count());
  console.log('Horizontal overflow:',await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth));
} finally { await browser.close(); }
