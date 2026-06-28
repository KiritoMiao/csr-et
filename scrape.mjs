import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'https://www.opentable.com';
const SAPPHIRE_URL = `${BASE_URL}/sapphire-reserve-exclusive-tables`;

// No hardcoded city list — all cities are discovered dynamically from the website

// Nominatim geocoding with 1 req/sec rate limit
async function geocode(name, neighborhood, city) {
  const queries = [
    `${name} restaurant, ${neighborhood}, ${city}, USA`,
    `${name}, ${neighborhood}, ${city}, USA`,
    `${neighborhood}, ${city}, USA`,
  ];

  for (const query of queries) {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=us`;
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'OpenTableSapphireMapScraper/1.0' }
      });
      const data = await res.json();
      if (data.length > 0) {
        return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      }
    } catch (e) {
      // try next query
    }
    await sleep(1100);
  }

  return null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Format city name from slug — fully dynamic, no hardcoded map
function slugToCity(slug) {
  return slug.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

async function discoverCities(page) {
  console.log('Discovering cities...');

  // Go to any Sapphire Reserve city page first (the main page may not have the dropdown)
  // Try the main page — if it has a city selector button, click it to reveal all cities
  await page.goto(SAPPHIRE_URL, { waitUntil: 'networkidle2', timeout: 30000 });

  // First collect any city links from the page
  const linkCities = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('a[href*="/sapphire-reserve/"]').forEach(link => {
      const match = link.href.match(/\/sapphire-reserve\/([a-z-]+)$/);
      if (match) results.push({ slug: match[1], name: link.textContent.trim() });
    });
    return results;
  });

  // Navigate to a known city page to access the city selector dropdown
  // Use the first discovered city, or try a common one
  const firstSlug = linkCities.length > 0 ? linkCities[0].slug : 'chicago';
  await page.goto(`${BASE_URL}/sapphire-reserve/${firstSlug}`, { waitUntil: 'networkidle2', timeout: 30000 });

  // Click the city selector button to open the dropdown with ALL cities
  // The button shows the current city name inside <main>
  await page.evaluate((city) => {
    const main = document.querySelector('main');
    if (!main) return;
    const btns = main.querySelectorAll('button');
    for (const b of btns) {
      if (b.textContent.trim() === city) { b.click(); break; }
    }
  }, slugToCity(firstSlug));

  await sleep(800); // Wait for dropdown to render

  // Extract all city names from the dropdown
  // They appear as buttons between "Current location" and the repeated current city button
  const allCities = await page.evaluate(() => {
    const results = [];
    const buttons = Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim());
    const startIdx = buttons.indexOf('Current location');
    if (startIdx === -1) return results;

    // City buttons follow "Current location" — collect until we hit a non-city button
    const nonCities = new Set(['Allow All','Back Button','Filter Icon','Clear','Apply',
      'Cancel','Reject All','Confirm My Choices','Dining Rewards','Reserve for Others',
      'About Us','Blog','Careers','Press','Affiliate Program','Contact Us',
      'Mobile','For Businesses','FAQs','EN','Join rewards','Sign in',
      'Search icon','Hamburger icon','Add your eligible card','Current location',
      'Save restaurant to favorites','Carousel indicator']);

    for (let i = startIdx + 1; i < buttons.length; i++) {
      const text = buttons[i];
      if (nonCities.has(text)) break;
      if (text.length > 2 && text.length < 40) {
        const slug = text.toLowerCase().replace(/[.']/g, '').replace(/\s+/g, '-');
        results.push({ slug, name: text });
      }
    }
    return results;
  });

  // Merge link-discovered and dropdown-discovered cities
  const slugMap = new Map();
  for (const { slug, name } of [...linkCities, ...allCities]) {
    if (!slugMap.has(slug)) slugMap.set(slug, name);
  }

  console.log(`Discovered ${slugMap.size} cities: ${[...slugMap.values()].join(', ')}`);
  return slugMap;
}

async function scrapeCityPage(page, slug) {
  const cityName = slugToCity(slug);
  const url = `${BASE_URL}/sapphire-reserve/${slug}`;
  console.log(`\nScraping ${cityName} (${url})...`);

  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

  let allRestaurants = [];
  let pageNum = 1;

  while (true) {
    console.log(`  Page ${pageNum}...`);

    const restaurants = await page.evaluate((city) => {
      const cards = document.querySelectorAll('a[href*="/r/"], a[href*="opentable.com/"]');
      const results = [];
      const seen = new Set();

      cards.forEach(card => {
        const href = card.getAttribute('href');
        if (!href) return;
        if (!card.querySelector('h3')) return;

        const fullUrl = href.startsWith('http') ? href : 'https://www.opentable.com' + href;
        if (seen.has(fullUrl)) return;
        seen.add(fullUrl);

        const nameEl = card.querySelector('h3');
        const name = nameEl ? nameEl.textContent.trim() : '';
        if (!name) return;

        // DOM structure (confirmed via inspection):
        //   <a> card
        //     <div> images/buttons
        //     <div> <h3>Name</h3> </div>
        //     <div> "Cuisine" <span>•</span> "Neighborhood" </div>
        //     <p> description </p>
        let cuisine = '';
        let neighborhood = '';
        let description = '';

        // h3 is inside a div; get sibling divs of that wrapper
        const nameWrapper = nameEl.parentElement;
        let sibling = nameWrapper.nextElementSibling;
        while (sibling) {
          const text = sibling.textContent.trim();
          if (!text) { sibling = sibling.nextElementSibling; continue; }

          // The cuisine•neighborhood div contains a • span
          if (sibling.querySelector('span') && text.includes('•')) {
            // Extract cuisine and neighborhood from child nodes
            const parts = [];
            for (const node of sibling.childNodes) {
              const t = node.textContent.trim();
              if (t && t !== '•') parts.push(t);
            }
            cuisine = parts[0] || '';
            neighborhood = parts[1] || '';
          } else if (!description) {
            // First non-meta text block is the description
            description = text;
          }
          sibling = sibling.nextElementSibling;
        }

        results.push({ name, cuisine, neighborhood, city, description, url: fullUrl });
      });

      return results;
    }, cityName);

    console.log(`  Found ${restaurants.length} restaurants on page ${pageNum}`);
    allRestaurants = allRestaurants.concat(restaurants);

    // Check for next page by looking for "next page" text or page number links
    const hasNextPage = await page.evaluate(() => {
      const allLinks = document.querySelectorAll('a');
      for (const link of allLinks) {
        const text = link.textContent.trim().toLowerCase();
        if (text.includes('next page') || text.includes('go to the next')) {
          return true;
        }
      }
      // Also check for numbered page links higher than current
      const currentUrl = window.location.href;
      const currentPage = currentUrl.match(/pageNumber=(\d+)/);
      const curNum = currentPage ? parseInt(currentPage[1]) : 1;
      for (const link of allLinks) {
        const text = link.textContent.trim();
        if (/^\d+$/.test(text) && parseInt(text) > curNum) {
          return true;
        }
      }
      return false;
    });

    if (hasNextPage) {
      pageNum++;
      const nextUrl = `${BASE_URL}/sapphire-reserve/${slug}?pageNumber=${pageNum}`;
      await page.goto(nextUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    } else {
      break;
    }
  }

  console.log(`  Total for ${cityName}: ${allRestaurants.length} restaurants`);
  return allRestaurants;
}

async function main() {
  console.log('=== OpenTable Sapphire Reserve Scraper ===\n');

  // --no-sandbox is required on CI runners (e.g. GitHub Actions ubuntu-latest),
  // which block the unprivileged user namespaces Chromium's sandbox relies on.
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  // Step 1: Discover cities dynamically from the website
  const cityMap = await discoverCities(page);

  // Step 2: Scrape each city
  let allRestaurants = [];
  for (const [slug, name] of cityMap) {
    try {
      const restaurants = await scrapeCityPage(page, slug);
      // If the page returned restaurants, it's a valid city
      if (restaurants.length > 0) {
        allRestaurants = allRestaurants.concat(restaurants);
      } else {
        console.log(`  Skipping ${name} — no restaurants found`);
      }
    } catch (err) {
      console.log(`  Skipping ${slug} — ${err.message}`);
    }
  }

  await browser.close();

  console.log(`\n=== Scraping complete: ${allRestaurants.length} restaurants total ===`);

  // Step 3: Geocode
  console.log('\nGeocoding restaurants (this may take a few minutes)...');
  let geocoded = 0;
  let failed = 0;

  for (const r of allRestaurants) {
    await sleep(1100); // Nominatim rate limit: 1 req/sec
    const coords = await geocode(r.name, r.neighborhood, r.city);
    if (coords) {
      r.lat = coords.lat;
      r.lng = coords.lng;
      geocoded++;
      console.log(`  ✓ ${r.name} → ${coords.lat}, ${coords.lng}`);
    } else {
      failed++;
      console.log(`  ✗ ${r.name} — geocoding failed, will need manual coordinates`);
      r.lat = null;
      r.lng = null;
    }
  }

  console.log(`\nGeocoded: ${geocoded}/${allRestaurants.length} (${failed} failed)`);

  // Step 4: Save
  const outDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const outPath = path.join(outDir, 'restaurants.json');
  fs.writeFileSync(outPath, JSON.stringify(allRestaurants, null, 2));
  console.log(`\nSaved to ${outPath}`);

  if (failed > 0) {
    console.log(`\n⚠️  ${failed} restaurants need manual coordinates. Edit data/restaurants.json to add lat/lng values.`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
