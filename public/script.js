// script.js
// Front-end binding med deduplikering, filtrering og max-grænser før rendering

document.addEventListener("DOMContentLoaded", async () => {
  const root = document.getElementById("root");

  // Hent forecast-data fra API
  const response = await fetch("/api/forecast");
  let data = await response.json();

  // ─── Deduplikér på flight + dato ───────────────────────────────────────────
  {
    const seen = new Set();
    const deduped = [];
    data.forEach(row => {
      const key = `${row.flight}_${row.flightDate}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(row);
      }
    });
    data = deduped;
  }

  // ─── Kun flynumre der starter med '1' ──────────────────────────────────────
  data = data.filter(row => row.flight.toString().startsWith("1"));

  // ─── Clamp expectedPassengers til maks 64 ────────────────────────────────
  data = data.map(row => ({
    ...row,
    expectedPassengers: Math.min(row.expectedPassengers, 64),
  }));

  // ─── Default sort: efter dato, derefter flightnummer ──────────────────────
  data.sort((a, b) => {
    if (a.flightDate < b.flightDate) return -1;
    if (a.flightDate > b.flightDate) return 1;
    return Number(a.flight) - Number(b.flight);
  });

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

  // Render-funktion, der laver filter, sort og binder til DOM
  const renderTable = () => {
    // Filtrer efter søgning
    let filtered = data.filter(item =>
      item.flight.toLowerCase().includes(filterText.toLowerCase()) ||
      item.flightDate.includes(filterText)
    );

    // Sortér med special-logik ved klik
    filtered.sort((a, b) => {
      if (sortField === "flightDate") {
        // Primær: dato, Sekundær: flightnummer
        if (a.flightDate !== b.flightDate) {
          return (a.flightDate < b.flightDate ? -1 : 1) * (sortAsc ? 1 : -1);
        }
        return (Number(a.flight) - Number(b.flight)) * (sortAsc ? 1 : -1);
      }
      const aVal = a[sortField];
      const bVal = b[sortField];
      // Numeric felter
      if (["flight","weekday","daysToDeparture","currentBookings","expectedPassengers","expectedRevenue"].includes(sortField)) {
        return (Number(aVal) - Number(bVal)) * (sortAsc ? 1 : -1);
      }
      // String/fallback
      return (aVal > bVal ? 1 : aVal < bVal ? -1 : 0) * (sortAsc ? 1 : -1);
    });

    // Generér tabel-HTML
    root.innerHTML = `
      <h1>Flight Forecast</h1>
      <input type="text" placeholder="Søg flight eller dato" value="${filterText}" />
      <table>
        <thead>
          <tr>
            ${headers.map(([title]) => `<th data-field="${title.toLowerCase().replace(/ /g, '')}">${title}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${filtered.map(row => `
            <tr>
              <td>${row.flight}</td>
              <td>${row.flightDate}</td>
              <td>${row.weekday}</td>
              <td>${row.daysToDeparture}</td>
              <td>${row.currentBookings}</td>
              <td>${row.expectedPassengers}</td>
              <td>${row.expectedRevenue}</td>
              <td>${row.loadFactor}</td>
              <td>${row.upgradeSuggestion}</td>
              <td>${row.note}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    // Tilføj click-events til kolonne-overskrifter for dynamisk sort
    document.querySelectorAll('th').forEach(th => {
      th.addEventListener('click', () => {
        const field = th.getAttribute('data-field');
        if (sortField === field) sortAsc = !sortAsc;
        else { sortField = field; sortAsc = true; }
        renderTable();
      });
    });
  };

  // Lyt på input-søgning
  root.querySelector('input').addEventListener('input', (e) => {
    filterText = e.target.value;
    renderTable();
  });

  renderTable();
});
