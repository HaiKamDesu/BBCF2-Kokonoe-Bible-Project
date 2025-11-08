(function () {
  const root = document.getElementById('combo-sections-root');
  if (!root) {
    return;
  }

  const source = root.dataset.source || 'combo-sections.json';

  const createHeader = (section) => {
    const header = document.createElement('h3');

    if (section.anchor) {
      const anchor = document.createElement('span');
      anchor.id = section.anchor;
      header.appendChild(anchor);
    }

    const headline = document.createElement('span');
    headline.className = 'mw-headline';
    if (section.headline_id) {
      headline.id = section.headline_id;
    }
    headline.innerHTML = section.title_html || '';
    header.appendChild(headline);

    return header;
  };

  const createDescriptions = (descriptions) => {
    const fragments = document.createDocumentFragment();
    descriptions.forEach((descriptionHtml) => {
      if (!descriptionHtml || !descriptionHtml.trim()) {
        return;
      }
      const paragraph = document.createElement('p');
      paragraph.innerHTML = descriptionHtml;
      fragments.appendChild(paragraph);
    });
    return fragments;
  };

  const createTable = (section) => {
    const table = document.createElement('table');
    table.className = 'wikitable sortable jquery-tablesorter';
    table.setAttribute('border', '1');
    table.setAttribute('style', 'margin: 1em auto 1em auto;text-align: center');

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');

    (section.columns_html || []).forEach((columnHtml) => {
      const th = document.createElement('th');
      th.className = 'headerSort';
      th.setAttribute('tabindex', '0');
      th.setAttribute('role', 'columnheader button');
      th.setAttribute('title', 'Sort ascending');
      th.innerHTML = (columnHtml || '').trim();
      headerRow.appendChild(th);
    });

    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    (section.rows_html || []).forEach((rowHtml) => {
      const row = document.createElement('tr');
      rowHtml.forEach((cellHtml) => {
        const cell = document.createElement('td');
        cell.innerHTML = cellHtml || '';
        row.appendChild(cell);
      });
      tbody.appendChild(row);
    });
    table.appendChild(tbody);

    table.appendChild(document.createElement('tfoot'));

    return table;
  };

  const initialiseTableSorter = () => {
    try {
      if (window.jQuery && window.jQuery.fn && typeof window.jQuery.fn.tablesorter === 'function') {
        const tables = window.jQuery(root).find('table.wikitable.sortable');
        tables.trigger('destroy');
        tables.tablesorter();
      }
    } catch (error) {
      console.warn('Unable to initialise tablesorter', error);
    }
  };

  fetch(source)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to fetch combo sections: ${response.status}`);
      }
      return response.json();
    })
    .then((sections) => {
      root.innerHTML = '';
      const fragment = document.createDocumentFragment();
      sections.forEach((section) => {
        fragment.appendChild(createHeader(section));
        if (Array.isArray(section.descriptions_html) && section.descriptions_html.length) {
          fragment.appendChild(createDescriptions(section.descriptions_html));
        }
        fragment.appendChild(createTable(section));
      });
      root.appendChild(fragment);
      initialiseTableSorter();
    })
    .catch((error) => {
      console.error(error);
      root.textContent = 'Unable to load combo tables.';
    });
})();
