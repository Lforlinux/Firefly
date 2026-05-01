import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'

const app = express()
app.use(cors())
app.use(express.json())

const PORT = 5174
const DATA_PATH = path.join(process.cwd(), 'data.json')

// Helper to load data
function loadData() {
  try {
    if (fs.existsSync(DATA_PATH)) {
      return JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'))
    }
  } catch (e) {
    console.error('Error loading data:', e)
  }
  return { snapshots: [], ukHoldings: [] }
}

// Helper to save data
function saveData(data) {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2))
  } catch (e) {
    console.error('Error saving data:', e)
  }
}

// API Routes

// Get snapshots
app.get('/api/snapshots', (req, res) => {
  const data = loadData()
  res.json(data.snapshots || [])
})

// Get holdings
app.get('/api/holdings', (req, res) => {
  const data = loadData()
  res.json(data.ukHoldings || [])
})

// Save holdings
app.post('/api/holdings', (req, res) => {
  const { holdings } = req.body
  const data = loadData()
  data.ukHoldings = holdings || []
  saveData(data)
  res.json({ success: true })
})

// Save snapshot
app.post('/api/snapshots', (req, res) => {
  const { snapshots } = req.body
  const data = loadData()
  data.snapshots = snapshots || []
  saveData(data)
  res.json({ success: true })
})

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' })
})

app.listen(PORT, () => {
  console.log(`🔥 Firefly API running on http://localhost:${PORT}`)
})
