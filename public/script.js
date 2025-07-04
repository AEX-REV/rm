// script.js
// Front-end binding med deduplikering før rendering

document.addEventListener("DOMContentLoaded", async () => {
  const root = document.getElementById("root");

  // Hent forecast-data fra API
  const response = await fetch("/api/forecast");
  let data = await response.json();

  // ─── Deduplikér på flight + dato ─────────────────────────────────────────
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
  // ────────────────────────────────────────────────────────────────────────────

  let filterText = "";
  let sortField = "flightDate";
  let sortAsc = true;

  // Render-funktion, der laver filter, sort og binder til DOM
  const renderTable = () => {
    let filtered = data.filter(item =>
      item.flight.toLowerCase().includes(filterText.toLowerCase()) ||
      item.flightDate.includes(filterText)
    );

    // Sortér
    filtered.sort((a, b) => {
      const av = a[sortField];
      const bv = b[sortField];
      return (av > bv ? 1 : av < bv ? -1 : 0) * (sortAsc ? 1 : -1);
    });

    // Generér tabel-HTML
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

    // Events til headers for sort
    document.querySelectorAll('th').forEach(th => {
      th.addEventListener('click', () => {
        const field = th.getAttribute('data-field');
        if (sortField === field) sortAsc = !sortAsc;
        else { sortField = field; sortAsc = true; }
        renderTable();
      });
    });
  };

  renderTable();
});
