// script.js
// Front-end binding med deduplikering, filtrering og max-grænser før rendering

// Vis loading-indikator
const root = document.getElementById("root");
root.innerHTML = `<p class="loading">Indlæser data…</p>`;

document.addEventListener("DOMContentLoaded", async () => {
  try {
    // Hent forecast-data fra API med cache-busting
    const url = `/api/forecast?_=${Date.now()}`;
    const response = await fetch(url, { cache: 'no-store' });

    if (!response.ok) {
      console.error(`HTTP error! status: ${response.status}`);
      root.innerHTML = `<p class="error">Fejl ved hentning af data: HTTP ${response.status}</p>`;
      return;
    }

    let data = await response.json();

    // ─── Deduplikér på flight + dato ────────────────────────────────────────
    const seen = new Set();
    data = data.filter(row => {
      const key = `${row.flight}_${row.flightDate}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // ─── Kun flynumre der starter med '1' ──────────────────────────────────
    data = data.filter(row => row.flight.toString().startsWith("1"));

    // ─── Clamp expectedPassengers til maks 64 ──────────────────────────────
    data = data.map(row => ({
      ...row,
      expectedPassengers: Math.min(row.expectedPassengers, 64),
    }));

    // ─── Default sort: efter dato, derefter flightnummer ────────────────────
    data.sort((a, b) => {
      if (a.flightDate < b.flightDate) return -1;
      if (a.flightDate > b.flightDate) return 1;
      return Number(a.flight) - Number(b.flight);
    });

    // Fjern loading-indikator før rendering
    renderTable(data);

  } catch (err) {
    console.error('Fetch error:', err);
    root.innerHTML = `<p class="error">Kan ikke hente data: ${err.message}</p>`;
  }
});

// Render-funktion, der laver filter, sort og binder til DOM (genbruges ved sortering/søgning)
function renderTable(data) {
  const root = document.getElementById("root");
  let filterText = "";
  let sortField = "flightDate";
  let sortAsc = true;

  const headers = [
    ["Flight", "flight"],
    ["Date", "flightDate"],
    ["Weekday", "weekday"],
    ["Days to Departure", "daysToDeparture"],
    ["Current Bookings", "currentBookings"],
    ["Expected Pax", "expectedPassengers"],
    ["Expected Revenue", "expectedRevenue"],
    ["Load Factor", "loadFactor"],
    ["Upgrade", "upgradeSuggestion"],
    ["Note", "note"]
  ];

  const update = () => {
    // Filtrer
    let filtered = data.filter(item =>
      item.flight.toLowerCase().includes(filterText.toLowerCase()) ||
      item.flightDate.includes(filterText)
    );

    // Sortér
    filtered.sort((a, b) => {
      if (sortField === "flightDate") {
        if (a.flightDate !== b.flightDate) {
          return (a.flightDate < b.flightDate ? -1 : 1) * (sortAsc ? 1 : -1);
        }
        return (Number(a.flight) - Number(b.flight)) * (sortAsc ? 1 : -1);
      }
      const aVal = a[sortField];
      const bVal = b[sortField];
      if (["flight","weekday","daysToDeparture","currentBookings","expectedPassengers","expectedRevenue"].includes(sortField)) {
        return (Number(aVal) - Number(bVal)) * (sortAsc ? 1 : -1);
      }
      return (aVal > bVal ? 1 : aVal < bVal ? -1 : 0) * (sortAsc ? 1 : -1);
    });

    // Generér HTML
    root.innerHTML = `
      <h1>Flight Forecast</h1>
      <input type="text" placeholder="Søg flight eller dato" />
      <table>
        <thead>
          <tr>
            ${headers.map(([title]) => `<th data-field="${title.toLowerCase().replace(/ /g, '')}">${title}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${filtered.map(row => `
            <tr>
              ${headers.map(([, field]) => `<td>${row[field] != null ? row[field] : ''}</td>`).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    // Events til sort
    root.querySelectorAll('th').forEach(th => {
      th.onclick = () => {
        const field = th.getAttribute('data-field');
        if (sortField === field) sortAsc = !sortAsc;
        else { sortField = field; sortAsc = true; }
        update();
      };
    });

    // Event til søgning
    const input = root.querySelector('input');
    input.value = filterText;
    input.oninput = (e) => {
      filterText = e.target.value;
      update();
    };
  };

  update();
}
