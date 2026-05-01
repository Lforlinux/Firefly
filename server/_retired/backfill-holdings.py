#!/usr/bin/env python3
"""
Backfill historical holding snapshots from Yahoo Finance.
Usage: python3 backfill-holdings.py [--days N]

Fetches up to 7 years of daily prices for each holding and stores in DB.
"""
import sqlite3
import sys
import os
from datetime import datetime, timedelta
from typing import List, Dict

# Add parent dir to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import yfinance as yf

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'firefly.db')

YAHOO_TICKER_MAP = {
    # UK ETFs
    'Invesco Nasdaq 100': 'EQQQ.L',
    'Vanguard S&P 500': 'VUAG.L',
    'iShares MSCI Japan': 'CSJP.L',
    'Vanguard FTSE Developed Europe': 'VEUR.L',
    'Vanguard FTSE Developed Asia Pacific Ex-Japan': 'VAPX.L',
    'iShares MSCI Emerging Markets IMI': 'EIMI.L',
    'iShares Physical Gold': 'SGLN.L',
    # US Stocks (NASDAQ)
    'Apple': 'AAPL',
    'Amazon': 'AMZN',
    'ASML': 'ASML',
    'Axon Enterprise': 'AXON',
    'Bloomsbury Publishing': 'BMY',
    'Crowdstrike': 'CRWD',
    'Alphabet (Class C)': 'GOOG',
    'Meta Platforms': 'META',
    'Microsoft': 'MSFT',
    'Cloudflare': 'NET',
    'Nvidia': 'NVDA',
    'Shopify': 'SHOP',
    'Snowflake': 'SNOW',
    'Tesla': 'TSLA',
}

def resolve_yahoo_ticker(symbol: str, name: str) -> str:
    """Resolve holding symbol to Yahoo ticker."""
    if name in YAHOO_TICKER_MAP:
        return YAHOO_TICKER_MAP[name]
    # Check if it's a UK ETF (has .L or known LSE pattern)
    if not symbol.endswith('.L') and not symbol.endswith('.LON'):
        # US stocks without suffix - use as-is (NASDAQ)
        return symbol
    # LSE stocks need .L suffix
    return symbol.replace('.LON', '.L')

def lse_price_to_pounds(price: float) -> float:
    """Convert LSE pence to pounds."""
    if price >= 1000:
        return price / 100
    return price

def get_holdings() -> List[Dict]:
    """Get holdings from Firefly DB."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    
    cur.execute("SELECT data FROM holdings_sync WHERE id = 1")
    row = cur.fetchone()
    conn.close()
    
    if not row:
        return []
    
    import json
    return json.loads(row[0])

def save_holding_snapshot(date: str, ticker: str, name: str, owner: str, 
                          units: float, price: float, value_gbp: float):
    """Save a single holding snapshot to DB."""
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("""
        INSERT OR REPLACE INTO holding_snapshots 
        (date, ticker, name, owner, units, price, value_gbp)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (date, ticker, name, owner, units, price, value_gbp))
    conn.commit()
    conn.close()

def backfill(holdings: List[Dict], days: int = 365 * 7):
    """Backfill historical data for holdings."""
    print(f"Backfilling up to {days} days for {len(holdings)} holdings...")
    
    end_date = datetime.now()
    start_date = end_date - timedelta(days=days)
    
    total_saved = 0
    
    for h in holdings:
        ticker = resolve_yahoo_ticker(h['symbol'], h['name'])
        name = h['name']
        owner = h.get('owner', 'KLN')
        units = h.get('units', 0)
        
        print(f"  Fetching {ticker} ({name})...")
        
        try:
            data = yf.download(ticker, start=start_date, end=end_date, progress=False)
            
            if data.empty:
                print(f"    No data for {ticker}")
                continue
            
            # Process each day
            saved = 0
            for (date, row) in data.iterrows():
                price = row['Close']
                if hasattr(price, 'iloc'):  # Handle multi-index
                    price = price.iloc[0]
                price = lse_price_to_pounds(price)
                value_gbp = units * price
                
                date_str = date.strftime('%Y-%m-%d')
                save_holding_snapshot(
                    date_str,
                    h['symbol'],
                    name,
                    owner,
                    units,
                    round(price, 2),
                    round(value_gbp, 2)
                )
                saved += 1
            
            print(f"    Saved {saved} days")
            total_saved += saved
            
        except Exception as e:
            print(f"    Error: {e}")
        
        # Rate limit
        import time
        time.sleep(0.2)
    
    print(f"Done! Saved {total_saved} historical snapshots.")

def main():
    days = 365 * 7  # Default 7 years
    
    args = sys.argv[1:]
    for i, arg in enumerate(args):
        if arg == '--days' and i + 1 < len(args):
            days = int(args[i + 1])
    
    holdings = get_holdings()
    if not holdings:
        print("No holdings synced. Run sync first.")
        sys.exit(1)
    
    backfill(holdings, days)

if __name__ == '__main__':
    main()
