// Scrapes the ERP's web UI with Playwright and returns raw rows for review —
// nothing here writes to Mongo yet. This is a scaffold: the login selectors
// in launchErpSession() and the row-parsing selectors in each scrapeErp*
// function are placeholders and must be swapped for the real ERP's markup
// (open its pages, inspect the actual form/table, update the TODOs below)
// before any of this returns real data.
import { chromium } from 'playwright';

const ERP_URL = process.env.ERP_URL;
const ERP_USERNAME = process.env.ERP_USERNAME;
const ERP_PASSWORD = process.env.ERP_PASSWORD;

async function launchErpSession() {
  if (!ERP_URL || !ERP_USERNAME || !ERP_PASSWORD) {
    throw new Error('Set ERP_URL, ERP_USERNAME, and ERP_PASSWORD in .env before running an ERP import.');
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(ERP_URL);

  // TODO: replace with the ERP's real login form selectors.
  await page.fill('#username', ERP_USERNAME);
  await page.fill('#password', ERP_PASSWORD);
  await page.click('#login-button');
  await page.waitForLoadState('networkidle');

  return { browser, page };
}

// TODO: point at the real customers list URL and map real column indices.
export async function scrapeErpCustomers() {
  const { browser, page } = await launchErpSession();
  try {
    await page.goto(`${ERP_URL}/customers`);
    await page.waitForSelector('table tbody tr');
    return page.$$eval('table tbody tr', trs => trs.map(tr => {
      const cells = [...tr.querySelectorAll('td')].map(td => td.textContent.trim());
      return {
        company: cells[0] || '',
        contactName: cells[1] || '',
        email: cells[2] || '',
        phone: cells[3] || ''
      };
    }));
  } finally {
    await browser.close();
  }
}

// TODO: point at the real inventory list URL and map real column indices.
export async function scrapeErpInventory() {
  const { browser, page } = await launchErpSession();
  try {
    await page.goto(`${ERP_URL}/inventory`);
    await page.waitForSelector('table tbody tr');
    return page.$$eval('table tbody tr', trs => trs.map(tr => {
      const cells = [...tr.querySelectorAll('td')].map(td => td.textContent.trim());
      return {
        sku: cells[0] || '',
        name: cells[1] || '',
        quantity: cells[2] || '',
        price: cells[3] || ''
      };
    }));
  } finally {
    await browser.close();
  }
}

// TODO: point at the real sales/orders list URL and map real column indices.
export async function scrapeErpSales() {
  const { browser, page } = await launchErpSession();
  try {
    await page.goto(`${ERP_URL}/sales`);
    await page.waitForSelector('table tbody tr');
    return page.$$eval('table tbody tr', trs => trs.map(tr => {
      const cells = [...tr.querySelectorAll('td')].map(td => td.textContent.trim());
      return {
        orderId: cells[0] || '',
        customer: cells[1] || '',
        amount: cells[2] || '',
        date: cells[3] || ''
      };
    }));
  } finally {
    await browser.close();
  }
}
