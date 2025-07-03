// server.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 8080;

const DATA_PATH = path.join(__dirname, 'public', 'data', 'current_snapshot.csv');
const dataDir = path.join(__dirname, 'public', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

app.use(express.static('public'));
app.use(bodyParser.text({ type: '*/*', limit: '100mb' }));

app.get('/ping', (req, res) => {
  res.send('pong');
});

function parseBookings(callback) {
  const bookings = [];

  if (!fs.existsSync(DATA_PATH)) {
    console.warn('⚠️ Ingen CSV-fil fundet endnu');
    return callback(bookings);
  }

  fs.createReadStream(DATA_PATH)
    .pipe(csv())
    .on('data', (row) => {
      if (!row.FlightDate || !row.BookingDate) return;

      bookings.push({
        FlightDate: new Date(row.FlightDate.split('T')[0]),
        BookingDate: new Date(row.BookingDate.split('T')[0]),
        RBD: row.RBD || row.str_Fare_Class_Short?.charAt(0) || '',
        FlightNumber: row.FlightNumber || row.str_Flight_Nmbrs || '',
        Price: parseFloat(row.TotalChargeAmount || '0'),
        Year: new Date(row.FlightDate).getFullYear(),
      });
    })
    .on('end', () => {
      callback(bookings);
    });
}

app.get('/api/forecast', (req, res) => {
  parseBookings((bookings) => {
    const today = new Date();
    const threeMonthsAhead = new Date();
    threeMonthsAhead.setMonth(today.getMonth() + 3);
    const thisYear = today.getFullYear();
    const lastYear = thisYear - 1;

    const futureFlights = bookings.filter(b =>
      b.FlightDate >= today &&
      b.FlightDate <= threeMonthsAhead &&
      b.Year === thisYear
    );

    const allLastYear = bookings.filter(b => b.Year === lastYear);

    const forecasts = [];
    const seen = new Set();

    futureFlights.forEach(flight => {
      const flightNumber = flight.FlightNumber;
      const flightDate = flight.FlightDate;
      const weekday = flightDate.getDay();
      const key = `${flightNumber}_${flightDate.toISOString().split('T')[0]}`;
      if (seen.has(key)) return;
      seen.add(key);

      const daysToDeparture = Math.floor((flightDate - today) / (1000 * 60 * 60 * 24));

      const currentBookings = futureFlights.filter(f =>
        f.FlightNumber === flightNumber &&
        f.FlightDate.getTime() === flightDate.getTime()
      );

      const lastYearEquivalent = new Date(flightDate);
      lastYearEquivalent.setFullYear(lastYear);
      const sameWeek = getISOWeek(flightDate) === getISOWeek(lastYearEquivalent);
      const lastYearSameFlight = allLastYear.filter(b =>
        b.FlightNumber === flightNumber &&
        b.FlightDate.getDay() === weekday &&
        getISOWeek(b.FlightDate) === getISOWeek(lastYearEquivalent)
      );

      const paxLastYear = lastYearSameFlight.length;
      const revenueLastYear = lastYearSameFlight.reduce((sum, b) => sum + b.Price, 0);

      const trendRatio = paxLastYear > 0 ? currentBookings.length / paxLastYear : 1;
      const expectedPassengers = Math.round(paxLastYear * trendRatio);
      const expectedRevenue = Math.round(expectedPassengers * (revenueLastYear / (paxLastYear || 1)));
      const loadFactor = Math.min(100, Math.round((expectedPassengers / 50) * 100));
      const upgrade = expectedPassengers > 60;
      const confidence = paxLastYear >= 10 ? 'high' : paxLastYear >= 5 ? 'medium' : 'low';

      const trendline = currentBookings.map(b => {
        const d = Math.floor((b.FlightDate - b.BookingDate) / (1000 * 60 * 60 * 24));
        return { daysBeforeDeparture: d };
      });

      const veryLow = expectedPassengers < paxLastYear * 0.5;

      forecasts.push({
        flight: flightNumber,
        flightDate: flightDate.toISOString().split('T')[0],
        weekday,
        daysToDeparture,
        currentBookings: currentBookings.length,
        expectedPassengers,
        expectedRevenue,
        loadFactor: `${loadFactor}%`,
        upgradeSuggestion: upgrade ? 'Overvej at åbne op til 64 pladser' : '',
        trendline,
        warning: veryLow ? 'Afgang bagud ift. historik' : '',
        confidence,
        note: `Baseret på ${paxLastYear} pax sidste år og ${trendRatio.toFixed(2)}x bookingtrend`
      });
    });

    res.json(forecasts);
  });
});

function getISOWeek(date) {
  const temp = new Date(date.getTime());
  temp.setHours(0, 0, 0, 0);
  temp.setDate(temp.getDate() + 4 - (temp.getDay() || 7));
  const yearStart = new Date(temp.getFullYear(), 0, 1);
  return Math.ceil((((temp - yearStart) / 86400000) + 1) / 7);
}

function generateSuggestions(bookings, thresholdPercent = 20) {
  const suggestions = [];
  const today = new Date();
  const thisYear = today.getFullYear();
  const grouped = {};

  bookings.forEach(b => {
    if (!b.FlightNumber || isNaN(b.FlightDate)) return;
    const weekday = b.FlightDate.getDay();
    const key = `${b.FlightNumber}_${weekday}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(b);
  });

  for (const [key, flights] of Object.entries(grouped)) {
    const [flightNumber, weekday] = key.split('_');
    const currentYear = flights.filter(f => f.Year === thisYear);
    const previousYear = flights.filter(f => f.Year === thisYear - 1);

    if (currentYear.length && previousYear.length) {
      const refFlight = currentYear[0];
      const daysToDeparture = Math.floor((refFlight.FlightDate - today) / (1000 * 60 * 60 * 24));

      if (daysToDeparture > 10) {
        const ratio = currentYear.length / previousYear.length;
        if (ratio > 1 + thresholdPercent / 100) {
          suggestions.push({
            flight: flightNumber,
            weekday: parseInt(weekday),
            bookingsThisYear: currentYear.length,
            bookingsLastYear: previousYear.length,
            daysToDeparture,
            recommendation: `Hæv prisen – ${currentYear.length} bookinger i år vs ${previousYear.length} sidste år.`,
          });
        }
      }
    }
  }
  return suggestions;
}

app.get('/api/suggestions', (req, res) => {
  const threshold = parseFloat(req.query.threshold) || 20;
  parseBookings((bookings) => {
    const suggestions = generateSuggestions(bookings, threshold);
    res.json(suggestions);
  });
});

app.post('/upload', (req, res) => {
  const rawData = req.body;
  if (!rawData || typeof rawData !== 'string') {
    return res.status(400).send('Ugyldig data');
  }

  fs.writeFile(DATA_PATH, rawData, (err) => {
    if (err) {
      console.error('🚫 Fejl ved skrivning af fil:', err);
      return res.status(500).send('Fejl ved upload');
    }
    console.log('✅ Fil uploadet og gemt som current_snapshot.csv');
    res.send('Upload gennemført');
  });
});

app.listen(PORT, () => {
  console.log(`✅ RM server kører på http://localhost:${PORT}`);
});
