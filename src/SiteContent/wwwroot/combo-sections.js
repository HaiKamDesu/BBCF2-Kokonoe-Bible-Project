function escapeHtml(value) {
  if (value == null) {
    return '';
  }
  return String(value).replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return character;
    }
  });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolveAutoFormatPreference(config) {
  if (!config || typeof config !== 'object') {
    return undefined;
  }

  if (config.autoFormat !== undefined) {
    return Boolean(config.autoFormat);
  }

  if (config.disableFormatting || config.formatting === 'none') {
    return false;
  }

  return undefined;
}

function buildWrappedHtml(text, rule) {
  if (typeof rule.replacement === 'string') {
    const escaped = escapeHtml(text);
    return rule.replacement.replace(/\{text\}/g, escaped).replace(/\$&/g, escaped);
  }

  const tagName = rule.tagName || 'span';
  const attributes = Object.assign({}, rule.attributes || {});
  if (rule.className) {
    if (attributes.class) {
      attributes.class = `${attributes.class} ${rule.className}`;
    } else {
      attributes.class = rule.className;
    }
  }

  const attributeText = Object.keys(attributes)
    .map((key) => ` ${key}="${escapeHtml(attributes[key])}"`)
    .join('');

  return `<${tagName}${attributeText}>${escapeHtml(text)}</${tagName}>`;
}

function createTokenMatchers(rule) {
  if (!Array.isArray(rule.tokens) || !rule.tokens.length) {
    return [];
  }

  const boundaryCharacters = rule.boundaryCharacters || 'A-Za-z0-9';
  const prefixPattern = rule.prefixPattern || `[^${boundaryCharacters}]`;
  const suffixPattern = rule.suffixPattern || `[^${boundaryCharacters}]`;
  const flags = rule.caseInsensitive ? 'gi' : 'g';

  const tokens = [...rule.tokens].sort((left, right) => right.length - left.length);

  return tokens.map((token) => {
    const regex = new RegExp(`(^|${prefixPattern})(${escapeRegExp(token)})(?=$|${suffixPattern})`, flags);

    return (value, insertPlaceholder) =>
      value.replace(regex, (match, prefix, captured) => `${prefix}${insertPlaceholder(buildWrappedHtml(captured, rule))}`);
  });
}

function createFormatter(config) {
  const rules = (config && Array.isArray(config.rules) ? config.rules : []).flatMap((rule) => createTokenMatchers(rule));

  return (text, options = {}) => {
    if (text == null) {
      return '';
    }

    const autoFormat = options.autoFormat !== false;
    if (!autoFormat || !rules.length) {
      return escapeHtml(text);
    }

    const placeholders = [];
    let working = String(text);

    rules.forEach((applyRule) => {
      working = applyRule(working, (html) => {
        const placeholder = `__FMT__${placeholders.length}__`;
        placeholders.push({ placeholder, html });
        return placeholder;
      });
    });

    let escaped = escapeHtml(working);
    placeholders.forEach(({ placeholder, html }) => {
      escaped = escaped.replace(new RegExp(escapeRegExp(placeholder), 'g'), html);
    });

    return escaped;
  };
}

(function () {
  const root = document.getElementById('combo-sections-root');
  if (!root) {
    return;
  }

  const source = root.dataset.source || 'combo-sections.json';
  const formattingSource = root.dataset.formattingRules || 'combo-formatting-rules.json';
  const tableDefinitionsSource = root.dataset.tableDefinitions || 'combo-table-definitions.json';

  const fetchJson = (url, { optional } = {}) =>
    fetch(url).then((response) => {
      if (!response.ok) {
        if (optional) {
          return null;
        }
        throw new Error(`Failed to fetch ${url}: ${response.status}`);
      }
      return response.json();
    });

  const createHeader = (section, formatText, defaultAutoFormat) => {
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
    let titleHtml = '';
    if (typeof section.title_html === 'string') {
      titleHtml = section.title_html;
    } else if (section.title && typeof section.title === 'object' && !Array.isArray(section.title)) {
      if (typeof section.title.html === 'string') {
        titleHtml = section.title.html;
      } else {
        const autoFormatOverride = resolveAutoFormatPreference(section.title);
        const text = section.title.text != null ? section.title.text : '';
        const formatted = formatText(text, {
          autoFormat: autoFormatOverride !== undefined ? autoFormatOverride : defaultAutoFormat,
        });

        if (section.title.wrap) {
          const tagName = section.title.wrap;
          titleHtml = `<${tagName}>${formatted}</${tagName}>`;
        } else {
          const before = section.title.before || '';
          const after = section.title.after || '';
          titleHtml = `${before}${formatted}${after}`;
        }
      }
    } else {
      const text = section.title_text || section.title || '';
      titleHtml = formatText(text, { autoFormat: defaultAutoFormat });
    }
    headline.innerHTML = titleHtml;
    header.appendChild(headline);

    return header;
  };

  const createDescriptions = (section, formatText, defaultAutoFormat) => {
    const hasHtml = Array.isArray(section.descriptions_html);
    const descriptions = hasHtml ? section.descriptions_html : section.descriptions;

    if (!Array.isArray(descriptions)) {
      return document.createDocumentFragment();
    }

    const fragments = document.createDocumentFragment();
    descriptions.forEach((description) => {
      let html;
      if (hasHtml && typeof description === 'string') {
        html = description;
      } else if (typeof description === 'string' || typeof description === 'number') {
        html = formatText(description, { autoFormat: defaultAutoFormat });
      } else if (description && typeof description === 'object') {
        if (typeof description.html === 'string') {
          html = description.html;
        } else {
          const autoFormatOverride = resolveAutoFormatPreference(description);
          const text = description.text != null ? description.text : '';
          html = formatText(text, {
            autoFormat: autoFormatOverride !== undefined ? autoFormatOverride : defaultAutoFormat,
          });
        }
      }

      if (!html || !html.trim()) {
        return;
      }

      const paragraph = document.createElement('p');
      paragraph.innerHTML = html;
      fragments.appendChild(paragraph);
    });
    return fragments;
  };

  const normaliseCell = (value, formatText, defaultAutoFormat) => {
    if (value == null) {
      return '';
    }

    if (typeof value === 'string' || typeof value === 'number') {
      return formatText(value, { autoFormat: defaultAutoFormat });
    }

    if (typeof value === 'object') {
      if (typeof value.html === 'string') {
        return value.html;
      }
      const autoFormatOverride = resolveAutoFormatPreference(value);
      const text = value.text != null ? value.text : '';
      return formatText(text, {
        autoFormat: autoFormatOverride !== undefined ? autoFormatOverride : defaultAutoFormat,
      });
    }

    return formatText(String(value), { autoFormat: defaultAutoFormat });
  };

  const mergeDefinitions = (base, extra) => {
    const merged = Object.assign({}, base || {});
    if (base && base.attributes) {
      merged.attributes = Object.assign({}, base.attributes);
    }

    if (extra && typeof extra === 'object') {
      const { attributes: extraAttributes, ...rest } = extra;
      Object.keys(rest).forEach((key) => {
        merged[key] = rest[key];
      });

      if (extraAttributes && typeof extraAttributes === 'object') {
        merged.attributes = Object.assign({}, merged.attributes || {}, extraAttributes);
      }
    }

    return merged;
  };

  const resolveDefinitionForType = (tableDefinitions, type, ancestry = []) => {
    if (!type) {
      return {};
    }

    if (ancestry.includes(type)) {
      console.warn('Circular table definition inheritance detected for type', type);
      return {};
    }

    const definition = tableDefinitions && tableDefinitions[type];
    if (!definition || typeof definition !== 'object') {
      return {};
    }

    const parentType = definition.extends || definition.extend;
    const parentDefinition = resolveDefinitionForType(tableDefinitions, parentType, ancestry.concat(type));
    const { extends: _extends, extend: _extend, ...ownDefinition } = definition;

    return mergeDefinitions(parentDefinition, ownDefinition);
  };

  const resolveTableConfig = (section, tableDefinitions) => {
    const tableSetting = section.table;
    let tableType;
    let overrides = {};

    if (typeof tableSetting === 'string') {
      tableType = tableSetting;
    } else if (tableSetting && typeof tableSetting === 'object' && !Array.isArray(tableSetting)) {
      tableType = tableSetting.type;
      overrides = tableSetting;
    }

    const defaults = {
      className: 'wikitable sortable jquery-tablesorter',
      attributes: {
        border: '1',
        style: 'margin: 1em auto 1em auto;text-align: center',
      },
      columns: [
        'Combo',
        {
          text: 'Damage',
          color: '#4EA5FF',
        },
        {
          text: 'Heat Gain',
          color: '#FF6B6B',
        },
        'Graviton Cost',
        'Notes',
        'Example',
      ],
    };

    const defaultDefinition = resolveDefinitionForType(tableDefinitions || {}, 'default');
    const typeDefinition = tableType ? resolveDefinitionForType(tableDefinitions || {}, tableType) : {};

    const { type: _type, ...overrideDefinition } = overrides && typeof overrides === 'object' ? overrides : {};

    const definition = mergeDefinitions(mergeDefinitions(defaultDefinition, typeDefinition), overrideDefinition);

    const className = definition.className || defaults.className;
    const attributes = Object.assign({}, defaults.attributes, definition.attributes || {});

    const columnsHtml = Array.isArray(section.columns_html)
      ? section.columns_html
      : Array.isArray(definition.columns_html)
      ? definition.columns_html
      : Array.isArray(definition.columnsHtml)
      ? definition.columnsHtml
      : undefined;

    const columns = columnsHtml
      ? undefined
      : Array.isArray(section.columns)
      ? section.columns
      : Array.isArray(definition.columns)
      ? definition.columns
      : Array.isArray(defaults.columns)
      ? defaults.columns
      : undefined;

    return {
      className,
      attributes,
      columns,
      columnsHtml,
    };
  };

  const createTable = (section, formatText, defaultAutoFormat, tableDefinitions) => {
    const tableConfig = resolveTableConfig(section, tableDefinitions);

    const table = document.createElement('table');
    table.className = tableConfig.className || '';
    Object.entries(tableConfig.attributes || {}).forEach(([attribute, value]) => {
      if (value != null) {
        table.setAttribute(attribute, value);
      }
    });

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');

    const columnValues = tableConfig.columnsHtml || tableConfig.columns;
    const columnConfigs = [];

    (columnValues || []).forEach((column) => {
      const th = document.createElement('th');
      th.className = 'headerSort';
      th.setAttribute('tabindex', '0');
      th.setAttribute('role', 'columnheader button');
      th.setAttribute('title', 'Sort ascending');
      let html;
      if (tableConfig.columnsHtml) {
        html = (column || '').trim();
        columnConfigs.push({});
      } else {
        const columnConfig = { textColor: null, autoFormat: undefined };
        const autoFormatOverride = resolveAutoFormatPreference(column);

        if (column && typeof column === 'object' && !Array.isArray(column)) {
          if (typeof column.html === 'string') {
            html = column.html;
          } else {
            const text = column.text != null ? column.text : '';
            html = formatText(text, {
              autoFormat:
                autoFormatOverride !== undefined ? autoFormatOverride : defaultAutoFormat,
            });
            if (column.wrap) {
              const tagName = column.wrap;
              html = `<${tagName}>${html}</${tagName}>`;
            } else if (column.before || column.after) {
              const before = column.before || '';
              const after = column.after || '';
              html = `${before}${html}${after}`;
            }
          }

          const textColor = column.text_color || column.textColor || column.color;
          if (textColor) {
            columnConfig.textColor = textColor;
          }
        } else {
          html = normaliseCell(column, formatText, defaultAutoFormat);
        }

        columnConfig.autoFormat = autoFormatOverride;
        columnConfigs.push(columnConfig);
      }

      th.innerHTML = html;
      const columnConfig = columnConfigs[columnConfigs.length - 1];
      if (columnConfig && columnConfig.textColor) {
        th.style.color = columnConfig.textColor;
      }
      headerRow.appendChild(th);
    });

    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    const rowValues = Array.isArray(section.rows_html) ? section.rows_html : section.rows;

    (rowValues || []).forEach((row) => {
      if (!Array.isArray(row)) {
        return;
      }

      const tr = document.createElement('tr');
      if (Array.isArray(section.rows_html)) {
        row.forEach((cellHtml, columnIndex) => {
          const cell = document.createElement('td');
          cell.innerHTML = cellHtml || '';
          const columnConfig = columnConfigs[columnIndex] || {};
          if (columnConfig.textColor) {
            cell.style.color = columnConfig.textColor;
          }
          tr.appendChild(cell);
        });
      } else {
        row.forEach((cellValue, columnIndex) => {
          const cell = document.createElement('td');
          const columnConfig = columnConfigs[columnIndex] || {};
          const columnAutoFormat =
            columnConfig.autoFormat !== undefined ? columnConfig.autoFormat : defaultAutoFormat;
          cell.innerHTML = normaliseCell(cellValue, formatText, columnAutoFormat);
          if (columnConfig.textColor) {
            cell.style.color = columnConfig.textColor;
          }
          tr.appendChild(cell);
        });
      }
      tbody.appendChild(tr);
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

  Promise.all([
    fetchJson(source),
    fetchJson(formattingSource, { optional: true }).catch((error) => {
      console.warn('Unable to load formatting rules', error);
      return null;
    }),
    fetchJson(tableDefinitionsSource, { optional: true }).catch((error) => {
      console.warn('Unable to load table definitions', error);
      return null;
    }),
  ])
    .then(([sections, formattingConfig, tableDefinitions]) => {
      const formatText = createFormatter(formattingConfig || { rules: [] });
      const resolvedDefinitions = tableDefinitions || {};

      root.innerHTML = '';
      const fragment = document.createDocumentFragment();
      sections.forEach((section) => {
        const defaultAutoFormat = !(
          section && (section.auto_format === false || section.auto_format === 'none')
        );
        fragment.appendChild(createHeader(section, formatText, defaultAutoFormat));
        fragment.appendChild(createDescriptions(section, formatText, defaultAutoFormat));
        fragment.appendChild(createTable(section, formatText, defaultAutoFormat, resolvedDefinitions));
      });
      root.appendChild(fragment);
      initialiseTableSorter();
    })
    .catch((error) => {
      console.error(error);
      root.textContent = 'Unable to load combo tables.';
    });
})();
