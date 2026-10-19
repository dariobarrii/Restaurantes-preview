// Shared browser data rules; no credentials or network side effects.
export function chooseAuthorizedBusiness(businesses, requestedId) {
  return businesses.find((b) => b.id === requestedId)?.id || businesses[0]?.id || null;
}

export async function readTenantPages(buildPage, { pageSize = 500, maxRows = 50000 } = {}) {
  const rows = [], ids = new Set();
  let expected;
  while (true) {
    const { data, error, count } = await buildPage(rows.length, rows.length + pageSize - 1);
    if (error) throw error;
    if (!Array.isArray(data) || !Number.isSafeInteger(count) || count < 0 || data.length > pageSize) throw new Error('La respuesta de datos está incompleta. Volvé a actualizar.');
    if (count > maxRows) throw new Error('El historial supera el límite de consulta del panel. Se necesita el informe agregado del servidor; no se mostrarán totales parciales.');
    if (expected !== undefined && count !== expected) throw new Error('Los datos cambiaron durante la lectura. Volvé a actualizar.');
    expected = count;
    for (const row of data) {
      if (row.id == null || ids.has(String(row.id))) throw new Error('La paginación devolvió registros repetidos o sin identificador. Volvé a actualizar.');
      ids.add(String(row.id)); rows.push(row);
    }
    if (rows.length === expected) return rows;
    if (!data.length || rows.length > expected) throw new Error('No se pudo leer el historial completo. Volvé a actualizar.');
  }
}

export function latestReviewDays(rows, dateKey) {
  const days = {};
  for (const row of rows) {
    const day = dateKey(new Date(row.captured_at));
    const item = days[day] ||= { open: null, close: null, latest: null };
    const field = row.platform === 'Google apertura' ? 'open' : row.platform === 'Google cierre' ? 'close' : null;
    const newer = (previous) => !previous || new Date(row.captured_at) > new Date(previous.captured_at);
    if (field && newer(item[field])) item[field] = row;
    if (newer(item.latest)) item.latest = row;
  }
  return days;
}

export function serializeCsv(rows) {
  const cell = (value) => {
    let text = String(value ?? '');
    if (/^[\s]*[=+\-@]|^[\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return '\uFEFF' + rows.map((row) => row.map(cell).join(';')).join('\r\n') + '\r\n';
}
