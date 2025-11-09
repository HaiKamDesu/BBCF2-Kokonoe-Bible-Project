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

  const ensureStyles = () => {
    if (document.getElementById('combo-section-styles')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'combo-section-styles';
    style.textContent = `
.combo-section__header,
.citizen-section-heading[role="button"] {
  cursor: pointer;
}

.citizen-section-heading {
  margin-top: 3rem;
  margin-bottom: 1.5rem;
}

.citizen-section-heading:first-of-type {
  margin-top: 0;
}

.citizen-section-heading--collapsed {
  margin-bottom: 3rem;
}

.combo-section__header {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin: 1.75rem 0 0.5rem;
}

.citizen-section .combo-section__header,
.citizen-section .combo-section__content {
  margin-left: 1.75rem;
}

.citizen-section .combo-section__content {
  margin-bottom: 1.75rem;
}

.combo-section__header:focus-visible,
.citizen-section-heading[role="button"]:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}

.combo-section__indicator {
  display: inline-block;
  min-width: 1rem;
  text-align: center;
}

.citizen-section-indicator {
  transition: transform 200ms ease;
}

.combo-section__content[hidden] {
  display: none !important;
}
`;

    if (document.head) {
      document.head.appendChild(style);
    }
  };

  ensureStyles();

  const CITIZEN_TOGGLE_DATA_KEY = 'citizenToggleInitialized';
  let citizenGeneratedId = 0;

  const initialiseCitizenSectionHeading = (heading) => {
    if (!heading || heading.classList.contains('combo-section__header')) {
      return;
    }

    if (heading.dataset[CITIZEN_TOGGLE_DATA_KEY] === 'true') {
      return;
    }

    const content = heading.nextElementSibling;
    if (!(content && content.matches('section.citizen-section'))) {
      return;
    }

    heading.dataset[CITIZEN_TOGGLE_DATA_KEY] = 'true';

    let indicator = heading.querySelector('.citizen-section-indicator');
    if (!indicator) {
      indicator = document.createElement('span');
      indicator.className = 'citizen-section-indicator citizen-ui-icon';
      indicator.setAttribute('aria-hidden', 'true');
      heading.insertBefore(indicator, heading.firstChild);
    }

    const indicatorElement = indicator;
    if (!indicatorElement.classList.contains('citizen-ui-icon')) {
      indicatorElement.classList.add('citizen-ui-icon');
    }
    indicatorElement.classList.remove('mw-ui-icon-wikimedia-expand');
    if (!indicatorElement.classList.contains('mw-ui-icon-wikimedia-collapse')) {
      indicatorElement.classList.add('mw-ui-icon-wikimedia-collapse');
    }

    if (!heading.hasAttribute('role')) {
      heading.setAttribute('role', 'button');
    }
    if (!heading.hasAttribute('tabindex')) {
      heading.tabIndex = 0;
    }

    const contentId =
      content.id ||
      heading.getAttribute('aria-controls') ||
      `${heading.id || 'citizen-section'}-${citizenGeneratedId++}`;
    if (!content.id) {
      content.id = contentId;
    }
    heading.setAttribute('aria-controls', contentId);

    const originalHiddenValue = content.getAttribute('hidden');
    if (originalHiddenValue != null) {
      content.dataset.citizenOriginalHiddenValue = originalHiddenValue;
    }

    const setCollapsed = (collapsed) => {
      if (collapsed) {
        if (indicatorElement) {
          indicatorElement.classList.remove('mw-ui-icon-wikimedia-collapse');
          if (!indicatorElement.classList.contains('mw-ui-icon-wikimedia-expand')) {
            indicatorElement.classList.add('mw-ui-icon-wikimedia-expand');
          }
        }
        const hiddenValue = content.dataset.citizenOriginalHiddenValue;
        if (hiddenValue) {
          content.setAttribute('hidden', hiddenValue);
        } else {
          content.setAttribute('hidden', '');
        }
        heading.setAttribute('aria-expanded', 'false');
        heading.classList.add('citizen-section-heading--collapsed');
      } else {
        if (indicatorElement) {
          indicatorElement.classList.remove('mw-ui-icon-wikimedia-expand');
          if (!indicatorElement.classList.contains('mw-ui-icon-wikimedia-collapse')) {
            indicatorElement.classList.add('mw-ui-icon-wikimedia-collapse');
          }
        }
        content.removeAttribute('hidden');
        heading.setAttribute('aria-expanded', 'true');
        heading.classList.remove('citizen-section-heading--collapsed');
      }
    };

    const toggleCollapsed = () => {
      const isCollapsed = heading.getAttribute('aria-expanded') === 'false';
      setCollapsed(!isCollapsed);
    };

    heading.addEventListener('click', (event) => {
      if (event.target.closest('a')) {
        return;
      }
      toggleCollapsed();
    });

    heading.addEventListener('keydown', (event) => {
      if (event.target !== heading) {
        return;
      }
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault();
        toggleCollapsed();
      }
    });

    const isInitiallyCollapsed =
      heading.classList.contains('citizen-section-heading--collapsed') ||
      (content.hasAttribute('hidden') && content.getAttribute('hidden') !== 'until-found');
    setCollapsed(isInitiallyCollapsed);
  };

  const initialiseCitizenSectionHeadings = () => {
    const headings = document.querySelectorAll('h2.citizen-section-heading');
    headings.forEach((heading) => initialiseCitizenSectionHeading(heading));
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialiseCitizenSectionHeadings, { once: true });
  } else {
    initialiseCitizenSectionHeadings();
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
    const fragment = document.createDocumentFragment();

    if (section.anchor) {
      const anchor = document.createElement('span');
      anchor.id = section.anchor;
      fragment.appendChild(anchor);
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
    fragment.appendChild(headline);

    return fragment;
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

    if (Array.isArray(value)) {
      return value
        .map((item) => normaliseCell(item, formatText, defaultAutoFormat))
        .filter((item) => item != null && item !== '')
        .join(' / ');
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

  const appendClassName = (existing, addition) => {
    if (!addition) {
      return existing || '';
    }

    const additions = Array.isArray(addition) ? addition : String(addition).split(/\s+/);
    const current = existing ? existing.split(/\s+/) : [];
    const merged = current.concat(additions).filter((value) => value);

    return Array.from(new Set(merged)).join(' ');
  };

  const normaliseHeaderConfig = (column) => {
    if (!column || typeof column !== 'object') {
      return null;
    }

    const baseHeader = column.header && typeof column.header === 'object' ? column.header : {};
    const headerConfig = {};

    const align =
      baseHeader.align != null
        ? baseHeader.align
        : column.header_align != null
        ? column.header_align
        : column.headerAlign;

    const classes = [];
    if (baseHeader.className) {
      classes.push(baseHeader.className);
    }
    if (baseHeader.class) {
      classes.push(baseHeader.class);
    }
    if (Array.isArray(baseHeader.classes)) {
      classes.push(...baseHeader.classes);
    }
    if (column.header_class) {
      classes.push(column.header_class);
    }
    if (column.headerClass) {
      classes.push(column.headerClass);
    }

    if (classes.length) {
      headerConfig.className = classes.join(' ');
    }

    const styles = [];
    if (baseHeader.style) {
      styles.push(baseHeader.style);
    }
    if (column.header_style) {
      styles.push(column.header_style);
    }
    if (column.headerStyle) {
      styles.push(column.headerStyle);
    }
    if (align) {
      styles.push(`text-align: ${align}`);
    }
    if (styles.length) {
      headerConfig.style = styles.join(';');
    }

    const attributes =
      baseHeader.attributes && typeof baseHeader.attributes === 'object'
        ? Object.assign({}, baseHeader.attributes)
        : null;
    if (attributes) {
      headerConfig.attributes = attributes;
    }

    if (!headerConfig.className && !headerConfig.style && !headerConfig.attributes) {
      return null;
    }

    return headerConfig;
  };

  const applyHeaderConfig = (th, headerConfig) => {
    if (!headerConfig) {
      return;
    }

    if (headerConfig.className) {
      th.className = appendClassName(th.className, headerConfig.className);
    }

    if (headerConfig.style) {
      const existing = th.style.cssText ? `${th.style.cssText};` : '';
      th.style.cssText = `${existing}${headerConfig.style}`;
    }

    if (headerConfig.attributes) {
      Object.entries(headerConfig.attributes).forEach(([attribute, value]) => {
        if (value != null) {
          th.setAttribute(attribute, value);
        }
      });
    }
  };

  const getInitialSortOrder = (columnConfig) => {
    if (!columnConfig || !columnConfig.sort || !columnConfig.sort.initialOrder) {
      return 'asc';
    }

    const order = String(columnConfig.sort.initialOrder).toLowerCase();
    return order === 'desc' ? 'desc' : 'asc';
  };

  const getCellSortValue = (cell, columnConfig, type) => {
    if (!cell) {
      return null;
    }

    const sortConfig = columnConfig && columnConfig.sort;
    const resolvedType = type || (sortConfig && sortConfig.type) || 'text';
    const attributeValue = cell.getAttribute('data-sort-value');

    if (attributeValue != null) {
      if (resolvedType === 'number') {
        const number = Number(attributeValue);
        return Number.isNaN(number) ? null : number;
      }
      return attributeValue;
    }

    const text = cell.textContent != null ? cell.textContent.trim() : '';

    if (!text) {
      return null;
    }

    if (resolvedType === 'number') {
      const match = text.match(/-?\d+(?:\.\d+)?/);
      if (!match) {
        return null;
      }
      const number = Number(match[0]);
      return Number.isNaN(number) ? null : number;
    }

    return text;
  };

  const collator =
    typeof Intl !== 'undefined' && typeof Intl.Collator === 'function'
      ? new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
      : null;

  const compareSortValues = (left, right, type) => {
    if (left == null && right == null) {
      return 0;
    }

    if (left == null) {
      return 1;
    }

    if (right == null) {
      return -1;
    }

    if (type === 'number') {
      const leftNumber = typeof left === 'number' ? left : Number(left);
      const rightNumber = typeof right === 'number' ? right : Number(right);

      const leftIsNaN = Number.isNaN(leftNumber);
      const rightIsNaN = Number.isNaN(rightNumber);

      if (leftIsNaN && rightIsNaN) {
        return 0;
      }

      if (leftIsNaN) {
        return 1;
      }

      if (rightIsNaN) {
        return -1;
      }

      if (leftNumber < rightNumber) {
        return -1;
      }

      if (leftNumber > rightNumber) {
        return 1;
      }

      return 0;
    }

    const leftText = typeof left === 'string' ? left : String(left);
    const rightText = typeof right === 'string' ? right : String(right);

    if (collator) {
      return collator.compare(leftText, rightText);
    }

    return leftText.localeCompare(rightText);
  };

  const enableNativeTableSorting = (table, columnConfigs) => {
    if (!table || !table.tBodies || !table.tBodies.length) {
      return;
    }

    const tbody = table.tBodies[0];
    const headerRow = table.tHead && table.tHead.rows && table.tHead.rows[0];
    if (!tbody || !headerRow) {
      return;
    }

    const headers = Array.from(headerRow.cells);
    if (!headers.length) {
      return;
    }

    const state = { columnIndex: null, order: 'asc' };

    const applySort = (columnIndex, order) => {
      const columnConfig = columnConfigs[columnIndex] || {};
      const sortConfig = columnConfig.sort || {};
      const type = sortConfig.type || 'text';

      const rowsWithValues = Array.from(tbody.rows).map((row, index) => {
        const cell = row.cells[columnIndex];
        return {
          row,
          index,
          value: getCellSortValue(cell, columnConfig, type),
        };
      });

      rowsWithValues.sort((left, right) => {
        const comparison = compareSortValues(left.value, right.value, type);
        if (comparison !== 0) {
          return order === 'desc' ? -comparison : comparison;
        }
        return left.index - right.index;
      });

      const fragment = document.createDocumentFragment();
      rowsWithValues.forEach(({ row }) => fragment.appendChild(row));
      tbody.appendChild(fragment);

      headers.forEach((header, index) => {
        const config = columnConfigs[index] || {};
        header.classList.remove('headerSortUp', 'headerSortDown');
        header.dataset.sortOrder = '';

        if (config.sortDisabled) {
          header.removeAttribute('aria-sort');
          header.removeAttribute('title');
          return;
        }

        header.setAttribute('aria-sort', 'none');
        header.setAttribute('title', 'Sort ascending');
      });

      const activeHeader = headers[columnIndex];
      if (activeHeader) {
        const ascending = order === 'asc';
        activeHeader.classList.add(ascending ? 'headerSortUp' : 'headerSortDown');
        activeHeader.setAttribute('aria-sort', ascending ? 'ascending' : 'descending');
        activeHeader.dataset.sortOrder = order;
        activeHeader.setAttribute('title', ascending ? 'Sort descending' : 'Sort ascending');
      }
    };

    const triggerSort = (columnIndex) => {
      const columnConfig = columnConfigs[columnIndex] || {};
      if (columnConfig.sortDisabled) {
        return;
      }

      const initialOrder = getInitialSortOrder(columnConfig);
      const order =
        state.columnIndex === columnIndex
          ? state.order === 'asc'
            ? 'desc'
            : 'asc'
          : initialOrder;

      state.columnIndex = columnIndex;
      state.order = order;
      applySort(columnIndex, order);
    };

    headers.forEach((header, index) => {
      const columnConfig = columnConfigs[index] || {};
      if (columnConfig.sortDisabled) {
        header.removeAttribute('tabindex');
        header.removeAttribute('role');
        header.removeAttribute('title');
        return;
      }

      const sortConfig = columnConfig.sort;
      if (!sortConfig || !sortConfig.type) {
        columnConfig.sort = Object.assign({}, columnConfig.sort || {}, { type: 'text' });
      }

      header.setAttribute('aria-sort', 'none');
      header.dataset.sortOrder = '';
      header.addEventListener('click', (event) => {
        event.preventDefault();
        triggerSort(index);
      });
      header.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          triggerSort(index);
        }
      });
    });
  };

  const normaliseSortConfig = (column) => {
    if (!column || typeof column !== 'object') {
      return null;
    }

    let sortConfig = column.sort || column.sortConfig || column.sorter;
    if (sortConfig == null) {
      return null;
    }

    if (sortConfig === false) {
      return null;
    }

    if (sortConfig === true) {
      sortConfig = {};
    }

    if (typeof sortConfig === 'string') {
      sortConfig = { type: sortConfig };
    }

    if (typeof sortConfig !== 'object') {
      return null;
    }

    const normalised = {};
    const type = sortConfig.type || column.sort_type || column.sortType;
    if (type) {
      const lower = String(type).toLowerCase();
      if (lower === 'number' || lower === 'numeric' || lower === 'digit') {
        normalised.type = 'number';
        normalised.sorter = sortConfig.sorter || 'digit';
      } else {
        normalised.type = lower;
        if (sortConfig.sorter) {
          normalised.sorter = sortConfig.sorter;
        }
      }
    }

    if (sortConfig.strategy) {
      normalised.strategy = sortConfig.strategy;
    } else if (sortConfig.mode) {
      normalised.strategy = sortConfig.mode;
    }

    if (sortConfig.initialOrder || sortConfig.order) {
      normalised.initialOrder = sortConfig.initialOrder || sortConfig.order;
    }

    if (!normalised.type && !normalised.sorter && !normalised.strategy && !normalised.initialOrder) {
      return {};
    }

    return normalised;
  };

  const computeNumericValues = (input, results, scratch) => {
    if (input == null) {
      return;
    }

    if (typeof input === 'number' && !Number.isNaN(input)) {
      results.push(input);
      return;
    }

    if (typeof input === 'string') {
      const matches = input.match(/-?\d+(?:\.\d+)?/g);
      if (matches) {
        matches.forEach((match) => {
          const value = Number(match);
          if (!Number.isNaN(value)) {
            results.push(value);
          }
        });
      }
      return;
    }

    if (Array.isArray(input)) {
      input.forEach((item) => computeNumericValues(item, results, scratch));
      return;
    }

    if (typeof input === 'object') {
      if (input.sort_value != null || input.sortValue != null) {
        computeNumericValues(input.sort_value != null ? input.sort_value : input.sortValue, results, scratch);
        return;
      }

      if (input.value != null) {
        computeNumericValues(input.value, results, scratch);
      }

      if (input.text != null) {
        computeNumericValues(input.text, results, scratch);
      }

      if (input.html != null && typeof input.html === 'string') {
        scratch.innerHTML = input.html;
        computeNumericValues(scratch.textContent || '', results, scratch);
        scratch.textContent = '';
      }
    }
  };

  const computeSortValue = (value, html, columnConfig) => {
    if (!columnConfig || !columnConfig.sort || !columnConfig.sort.type) {
      return null;
    }

    if (columnConfig.sort.type === 'number') {
      const scratch = document.createElement('div');
      const numbers = [];
      computeNumericValues(value, numbers, scratch);

      if (!numbers.length && typeof html === 'string' && html) {
        scratch.innerHTML = html;
        computeNumericValues(scratch.textContent || '', numbers, scratch);
      }

      if (!numbers.length) {
        return null;
      }

      const strategy = columnConfig.sort.strategy ? String(columnConfig.sort.strategy).toLowerCase() : 'first';
      switch (strategy) {
        case 'max':
          return Math.max(...numbers);
        case 'min':
          return Math.min(...numbers);
        case 'sum':
          return numbers.reduce((total, current) => total + current, 0);
        default:
          return numbers[0];
      }
    }

    if (columnConfig.sort.type === 'text') {
      if (value == null) {
        if (typeof html === 'string') {
          const scratch = document.createElement('div');
          scratch.innerHTML = html;
          const text = scratch.textContent || '';
          return text.trim();
        }
        return '';
      }

      if (typeof value === 'string' || typeof value === 'number') {
        return String(value).trim();
      }

      if (Array.isArray(value)) {
        return value.map((item) => computeSortValue(item, null, { sort: { type: 'text' } })).join(' ');
      }

      if (typeof value === 'object') {
        if (typeof value.text === 'string' || typeof value.text === 'number') {
          return String(value.text).trim();
        }
        if (typeof value.value === 'string' || typeof value.value === 'number') {
          return String(value.value).trim();
        }
        if (typeof value.html === 'string') {
          const scratch = document.createElement('div');
          scratch.innerHTML = value.html;
          const text = scratch.textContent || '';
          return text.trim();
        }
      }

      return '';
    }

    return null;
  };

  const applyValueColor = (element, color) => {
    if (!color || !element) {
      return;
    }

    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    while (walker.nextNode()) {
      const current = walker.currentNode;
      if (current && /\d/.test(current.nodeValue || '')) {
        nodes.push(current);
      }
    }

    nodes.forEach((textNode) => {
      const value = textNode.nodeValue || '';
      const fragment = document.createDocumentFragment();
      let lastIndex = 0;
      value.replace(/\d+(?:\.\d+)?/g, (match, index) => {
        if (index > lastIndex) {
          fragment.appendChild(document.createTextNode(value.slice(lastIndex, index)));
        }

        const span = document.createElement('span');
        span.style.color = color;
        span.textContent = match;
        fragment.appendChild(span);
        lastIndex = index + match.length;
        return match;
      });

      if (lastIndex < value.length) {
        fragment.appendChild(document.createTextNode(value.slice(lastIndex)));
      }

      if (textNode.parentNode) {
        textNode.parentNode.replaceChild(fragment, textNode);
      }
    });
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
          header: {
            align: 'center',
          },
          sort: {
            type: 'number',
            strategy: 'max',
          },
        },
        {
          text: 'Heat Gain',
          color: '#FF6B6B',
          header: {
            align: 'center',
          },
          sort: {
            type: 'number',
            strategy: 'max',
          },
        },
        {
          text: 'Graviton Cost',
          header: {
            align: 'center',
          },
          sort: {
            type: 'number',
            strategy: 'max',
          },
        },
        'Notes',
        {
          text: 'Example',
          header: {
            align: 'center',
          },
        },
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
      const columnConfig = {
        autoFormat: undefined,
        headerColor: null,
        valueColor: null,
        header: null,
        sort: null,
        sortDisabled: false,
      };

      if (tableConfig.columnsHtml) {
        html = (column || '').trim();
      } else {
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

          const headerColor =
            column.header_text_color ||
            column.headerTextColor ||
            column.header_color ||
            column.headerColor ||
            column.text_color ||
            column.textColor ||
            column.color;
          if (headerColor) {
            columnConfig.headerColor = headerColor;
          }

          const valueColor =
            column.value_text_color ||
            column.valueTextColor ||
            column.value_color ||
            column.valueColor ||
            column.color;
          if (valueColor) {
            columnConfig.valueColor = valueColor;
          }

          const headerConfig = normaliseHeaderConfig(column);
          if (headerConfig) {
            columnConfig.header = headerConfig;
          }

          const sortConfig = normaliseSortConfig(column);
          if (sortConfig) {
            columnConfig.sort = sortConfig;
          } else if (
            column &&
            (column.sort === false || column.sortConfig === false || column.sorter === false)
          ) {
            columnConfig.sortDisabled = true;
          }
        } else {
          html = normaliseCell(column, formatText, defaultAutoFormat);
        }

        columnConfig.autoFormat = autoFormatOverride;
      }

      columnConfigs.push(columnConfig);

      th.innerHTML = html;
      if (columnConfig.headerColor) {
        th.style.color = columnConfig.headerColor;
      }
      if (columnConfig.header) {
        applyHeaderConfig(th, columnConfig.header);
      }
      if (columnConfig.sort) {
        if (columnConfig.sort.sorter) {
          th.dataset.sorter = columnConfig.sort.sorter;
        }
        if (columnConfig.sort.initialOrder) {
          th.dataset.sortInitialOrder = columnConfig.sort.initialOrder;
        }
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
          const html = cellHtml || '';
          cell.innerHTML = html;
          const columnConfig = columnConfigs[columnIndex] || {};
          const sortValue = computeSortValue(cellHtml, html, columnConfig);
          if (sortValue != null) {
            cell.setAttribute('data-sort-value', sortValue);
          }
          if (columnConfig.valueColor) {
            applyValueColor(cell, columnConfig.valueColor);
          }
          tr.appendChild(cell);
        });
      } else {
        row.forEach((cellValue, columnIndex) => {
          const cell = document.createElement('td');
          const columnConfig = columnConfigs[columnIndex] || {};
          const columnAutoFormat =
            columnConfig.autoFormat !== undefined ? columnConfig.autoFormat : defaultAutoFormat;
          const html = normaliseCell(cellValue, formatText, columnAutoFormat);
          cell.innerHTML = html;
          const sortValue = computeSortValue(cellValue, html, columnConfig);
          if (sortValue != null) {
            cell.setAttribute('data-sort-value', sortValue);
          }
          if (columnConfig.valueColor) {
            applyValueColor(cell, columnConfig.valueColor);
          }
          tr.appendChild(cell);
        });
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    table.appendChild(document.createElement('tfoot'));

    if (!(window.jQuery && window.jQuery.fn && typeof window.jQuery.fn.tablesorter === 'function')) {
      enableNativeTableSorting(table, columnConfigs);
    }

    return table;
  };

  const createSection = (section, formatText, defaultAutoFormat, tableDefinitions, index) => {
    const fragment = document.createDocumentFragment();

    const headerContent = createHeader(section, formatText, defaultAutoFormat);

    const header = document.createElement('h3');
    header.className = 'combo-section__header';

    const indicator = document.createElement('span');
    indicator.className = 'combo-section__indicator';
    indicator.setAttribute('aria-hidden', 'true');
    indicator.textContent = '▼';
    header.appendChild(indicator);

    while (headerContent.firstChild) {
      header.appendChild(headerContent.firstChild);
    }

    const baseId =
      (section && (section.headline_id || section.anchor)) || `combo-section-${index}`;
    const contentId = `${String(baseId).replace(/\s+/g, '-')}-content`;
    header.setAttribute('aria-controls', contentId);
    header.setAttribute('aria-expanded', 'true');
    header.setAttribute('role', 'button');
    header.tabIndex = 0;

    const content = document.createElement('section');
    content.className = 'citizen-section combo-section__content';
    content.id = contentId;

    const descriptions = createDescriptions(section, formatText, defaultAutoFormat);
    if (descriptions && descriptions.childNodes && descriptions.childNodes.length) {
      content.appendChild(descriptions);
    }

    const table = createTable(section, formatText, defaultAutoFormat, tableDefinitions);
    if (table) {
      content.appendChild(table);
    }

    const setCollapsed = (collapsed) => {
      if (collapsed) {
        indicator.textContent = '▲';
        content.setAttribute('hidden', '');
        header.setAttribute('aria-expanded', 'false');
        header.classList.add('combo-section__header--collapsed');
      } else {
        indicator.textContent = '▼';
        content.removeAttribute('hidden');
        header.setAttribute('aria-expanded', 'true');
        header.classList.remove('combo-section__header--collapsed');
      }
    };

    const toggleCollapsed = () => {
      const isCollapsed = header.getAttribute('aria-expanded') === 'false';
      setCollapsed(!isCollapsed);
    };

    header.addEventListener('click', (event) => {
      if (event.target.closest('a')) {
        return;
      }
      toggleCollapsed();
    });
    header.addEventListener('keydown', (event) => {
      if (event.target !== header) {
        return;
      }
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault();
        toggleCollapsed();
      }
    });

    setCollapsed(false);

    fragment.appendChild(header);
    fragment.appendChild(content);

    return fragment;
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
      sections.forEach((section, index) => {
        const defaultAutoFormat = !(
          section && (section.auto_format === false || section.auto_format === 'none')
        );
        fragment.appendChild(
          createSection(section, formatText, defaultAutoFormat, resolvedDefinitions, index)
        );
      });
      root.appendChild(fragment);
      initialiseTableSorter();
    })
    .catch((error) => {
      console.error(error);
      root.textContent = 'Unable to load combo tables.';
    });
})();
