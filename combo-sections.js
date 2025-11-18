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
  const COLLAPSE_ICON_MASK =
    'data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAyMCAyMCc+PHBhdGggZmlsbD0nd2hpdGUnIGQ9J001IDdsNSA2IDUtNnonLz48L3N2Zz4=';
  const EXPAND_ICON_MASK =
    'data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAyMCAyMCc+PHBhdGggZmlsbD0nd2hpdGUnIGQ9J003IDVsNiA1LTYgNXonLz48L3N2Zz4=';
  const COMBO_SECTIONS_ROOT_ID = 'combo-sections-root';
  const DATABASE_ROOT_ID = 'combo-database-root';
  const VIEW_MODES = { GUIDE: 'guide', DATABASE: 'database' };

  let comboRoot = null;
  let guideRoot = null;
  let databaseRoot = null;
  let currentViewMode = VIEW_MODES.GUIDE;
  let cachedSections = [];
  let cachedFormatText = null;
  let cachedTableDefinitions = {};
  let hasInitialised = false;
  const FILTER_STATE_STORAGE_KEY = 'comboFilters.state';
  const CUSTOM_PRESETS_STORAGE_KEY = 'comboFilters.customPresets';
  const columnRegistry = new Map();
  const sectionRegistry = new Map();
  let tableMetadataList = [];
  let tableMetadataMap = new WeakMap();
  let resetBaselineState = null;
  let filterState = createDefaultFilterState();
  let customPresets = [];
  let builtInPresets = [];
  let filterInterface = null;
  let isFilterPanelOpen = false;
  const columnUiState = new Map();
  const sectionUiState = new Map();
  let tocObserver = null;
  let hasStoredFilterState = false;
  let latestSectionVisibility = new Map();
  let defaultPresetValue = '';

  function createEmptyFilterState() {
    return {
      hiddenColumns: new Set(),
      hiddenSections: new Set(),
      columnConditions: {},
      hideEmptySections: false,
    };
  }

  function createDefaultFilterState() {
    const base = resetBaselineState || {};
    return {
      hiddenColumns: new Set(base.hiddenColumns || []),
      hiddenSections: new Set(base.hiddenSections || []),
      columnConditions: Object.assign({}, base.columnConditions || {}),
      hideEmptySections: Boolean(base.hideEmptySections),
    };
  }

  function normaliseEnumValues(values = []) {
    return Array.from(
      new Set(
        (values || [])
          .map((value) => (value == null ? '' : String(value).trim().toLowerCase()))
          .filter((value) => value),
      ),
    );
  }

  function applyTooltip(element, description) {
    if (!element) {
      return;
    }
    const tooltip = description && String(description).trim();
    if (tooltip) {
      element.setAttribute('title', tooltip);
    } else {
      element.removeAttribute('title');
    }
  }

  function buildTooltip(description, hint, options = {}) {
    const descriptionText = description && String(description).trim();
    const hintText = hint && String(hint).trim();
    const separator = options.separator || ' ';
    return [descriptionText, hintText].filter(Boolean).join(separator);
  }

  const safeStorage = (() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage;
      }
    } catch (error) {
      return null;
    }
    return null;
  })();

  const readStorage = (key) => {
    if (!safeStorage || !key) {
      return null;
    }
    try {
      return safeStorage.getItem(key);
    } catch (error) {
      return null;
    }
  };

  const writeStorage = (key, value) => {
    if (!safeStorage || !key) {
      return;
    }
    try {
      if (value == null) {
        safeStorage.removeItem(key);
      } else {
        safeStorage.setItem(key, value);
      }
    } catch (error) {
      /* noop */
    }
  };

  function cloneCondition(condition) {
    if (!condition || typeof condition !== 'object') {
      return null;
    }

    if (condition.type === 'number') {
      const numericValue = Number(condition.value);
      if (Number.isNaN(numericValue)) {
        return null;
      }
      return {
        type: 'number',
        operator: condition.operator || 'gte',
        value: numericValue,
      };
    }

    if (condition.type === 'text') {
      const textValue = condition.value != null ? String(condition.value) : '';
      if (!textValue.trim()) {
        return null;
      }
      return {
        type: 'text',
        mode: condition.mode || 'contains',
        value: textValue,
      };
    }

    if (condition.type === 'enum') {
      const values = normaliseEnumValues(condition.values);
      if (!values.length) {
        return null;
      }
      return {
        type: 'enum',
        mode: condition.mode === 'exclude' ? 'exclude' : 'include',
        values,
      };
    }

    return null;
  }

  function cloneFilterState(state) {
    const nextState = createDefaultFilterState();
    if (!state || typeof state !== 'object') {
      return nextState;
    }

    nextState.hideEmptySections = Boolean(state.hideEmptySections);
    nextState.hiddenColumns = new Set(
      Array.isArray(state.hiddenColumns)
        ? state.hiddenColumns
        : state.hiddenColumns instanceof Set
        ? Array.from(state.hiddenColumns)
        : [],
    );
    nextState.hiddenSections = new Set(
      Array.isArray(state.hiddenSections)
        ? state.hiddenSections
        : state.hiddenSections instanceof Set
        ? Array.from(state.hiddenSections)
        : [],
    );
    nextState.columnConditions = {};

    const entries = state.columnConditions && typeof state.columnConditions === 'object' ? Object.entries(state.columnConditions) : [];
    entries.forEach(([key, condition]) => {
      const cloned = cloneCondition(condition);
      if (cloned) {
        nextState.columnConditions[key] = cloned;
      }
    });

    return nextState;
  }

  function serialiseCondition(condition) {
    if (!condition || typeof condition !== 'object') {
      return null;
    }
    if (condition.type === 'number') {
      return { type: 'number', operator: condition.operator || 'gte', value: condition.value };
    }
    if (condition.type === 'text') {
      return { type: 'text', mode: condition.mode || 'contains', value: condition.value };
    }
    if (condition.type === 'enum') {
      return { type: 'enum', mode: condition.mode === 'exclude' ? 'exclude' : 'include', values: normaliseEnumValues(condition.values) };
    }
    return null;
  }

  function serialiseFilterState(state) {
    const serialised = {
      hideEmptySections: Boolean(state.hideEmptySections),
      hiddenColumns: Array.from(state.hiddenColumns || []),
      hiddenSections: Array.from(state.hiddenSections || []),
      columnConditions: {},
    };

    const entries = state.columnConditions && typeof state.columnConditions === 'object' ? Object.entries(state.columnConditions) : [];
    entries.forEach(([key, condition]) => {
      const serialisedCondition = serialiseCondition(condition);
      if (serialisedCondition) {
        serialised.columnConditions[key] = serialisedCondition;
      }
    });

    return serialised;
  }

  function loadFilterStateFromStorage() {
    const stored = readStorage(FILTER_STATE_STORAGE_KEY);
    hasStoredFilterState = Boolean(stored);
    if (!stored) {
      return createDefaultFilterState();
    }

    try {
      const parsed = JSON.parse(stored);
      const state = createDefaultFilterState();
      state.hideEmptySections = Boolean(parsed.hideEmptySections);
      state.hiddenColumns = new Set(Array.isArray(parsed.hiddenColumns) ? parsed.hiddenColumns : []);
      state.hiddenSections = new Set(Array.isArray(parsed.hiddenSections) ? parsed.hiddenSections : []);
      state.columnConditions = {};
      if (parsed.columnConditions && typeof parsed.columnConditions === 'object') {
        Object.entries(parsed.columnConditions).forEach(([key, condition]) => {
          const cloned = cloneCondition(condition);
          if (cloned) {
            state.columnConditions[key] = cloned;
          }
        });
      }
      return state;
    } catch (error) {
      return createDefaultFilterState();
    }
  }

  function persistFilterState() {
    const serialised = serialiseFilterState(filterState);
    writeStorage(FILTER_STATE_STORAGE_KEY, JSON.stringify(serialised));
  }

  function loadCustomPresetsFromStorage() {
    const stored = readStorage(CUSTOM_PRESETS_STORAGE_KEY);
    if (!stored) {
      return [];
    }

    try {
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .map((preset) => ({
          key: preset && preset.key ? String(preset.key) : '',
          name: preset && preset.name ? String(preset.name) : '',
          description: preset && preset.description ? String(preset.description) : '',
          state: cloneFilterState(preset ? preset.state : null),
        }))
        .filter((preset) => preset.key && preset.name);
    } catch (error) {
      return [];
    }
  }

  function persistCustomPresets() {
    const payload = customPresets.map((preset) => ({
      key: preset.key,
      name: preset.name,
      description: preset.description || '',
      state: serialiseFilterState(preset.state || createDefaultFilterState()),
    }));
    writeStorage(CUSTOM_PRESETS_STORAGE_KEY, JSON.stringify(payload));
  }

  filterState = loadFilterStateFromStorage();
  customPresets = loadCustomPresetsFromStorage();

  function normalisePresetDefinitions(definitions) {
    if (!Array.isArray(definitions)) {
      return [];
    }

    return definitions
      .map((definition) => {
        if (!definition || typeof definition !== 'object') {
          return null;
        }

        const key = definition.key && String(definition.key).trim();
        const name = definition.name && String(definition.name).trim();
        if (!key || !name) {
          return null;
        }

        const description = definition.description ? String(definition.description).trim() : '';
          return {
            key,
            name,
            description,
            defaultReset: Boolean(definition.defaultReset),
            state: cloneFilterState(definition.state),
          };
        })
      .filter((preset) => preset && preset.key && preset.name);
  }

  const textExtractionScratch = document.createElement('div');

  function extractTextContent(html) {
    if (!html) {
      return '';
    }
    textExtractionScratch.innerHTML = html;
    const text = textExtractionScratch.textContent || '';
    textExtractionScratch.innerHTML = '';
    return text;
  }

  function resolveColumnLabel(column, index) {
    if (typeof column === 'string' && column.trim()) {
      const trimmed = column.trim();
      if (trimmed.includes('<')) {
        return extractTextContent(trimmed).trim() || `Column ${index + 1}`;
      }
      return trimmed;
    }
    if (column && typeof column === 'object') {
      if (typeof column.text === 'string' && column.text.trim()) {
        return column.text.trim();
      }
      if (typeof column.label === 'string' && column.label.trim()) {
        return column.label.trim();
      }
      if (column.header && typeof column.header.text === 'string' && column.header.text.trim()) {
        return column.header.text.trim();
      }
      if (typeof column.html === 'string' && column.html.trim()) {
        return extractTextContent(column.html).trim();
      }
    }
    return `Column ${index + 1}`;
  }

  function resolveSectionLabel(section, index) {
    const fallback = `Section ${index + 1}`;
    if (!section || typeof section !== 'object') {
      return fallback;
    }
    if (typeof section.title_html === 'string' && section.title_html.trim()) {
      const extracted = extractTextContent(section.title_html).trim();
      if (extracted) {
        return extracted;
      }
    }
    if (typeof section.title === 'string' && section.title.trim()) {
      return section.title.trim();
    }
    if (section.title && typeof section.title === 'object') {
      if (typeof section.title.text === 'string' && section.title.text.trim()) {
        return section.title.text.trim();
      }
      if (typeof section.title.html === 'string' && section.title.html.trim()) {
        const extracted = extractTextContent(section.title.html).trim();
        if (extracted) {
          return extracted;
        }
      }
    }
    if (typeof section.anchor === 'string' && section.anchor.trim()) {
      return section.anchor.trim();
    }
    if (typeof section.headline_id === 'string' && section.headline_id.trim()) {
      return section.headline_id.trim();
    }
    return fallback;
  }

  function createColumnKey(label, index) {
    const fallback = `column-${index + 1}`;
    if (!label) {
      return fallback;
    }
    const slug = String(label)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return slug || fallback;
  }

  function resolveColumnInfo(column, index) {
    const label = resolveColumnLabel(column, index);
    const key = createColumnKey(label, index);
    const filterType = determineFilterTypeFromColumn(column);
    const filterEnabled = determineFilterEnabledFromColumn(column);
    return { key, label, filterType, filterEnabled };
  }

  function normaliseFilterType(value) {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) {
      return null;
    }
    if (['number', 'numeric', 'int', 'integer', 'float', 'decimal'].includes(trimmed)) {
      return 'number';
    }
    if (['enum', 'enumeration', 'list', 'select', 'boolean', 'bool'].includes(trimmed)) {
      return 'enum';
    }
    return 'text';
  }

  function determineFilterTypeFromColumn(column) {
    if (!column || typeof column !== 'object') {
      return null;
    }
    const typeValue =
      column.type ||
      column.filterType ||
      column.filter_type ||
      (column.filter && typeof column.filter === 'object' && (column.filter.type || column.filter.filterType));
    const normalised = normaliseFilterType(typeValue);
    if (normalised) {
      return normalised;
    }
    if (column.sort && column.sort.type === 'number') {
      return 'number';
    }
    return null;
  }

  function determineFilterEnabledFromColumn(column) {
    if (!column || typeof column !== 'object') {
      return undefined;
    }
    const filterConfig = column.filter && typeof column.filter === 'object' ? column.filter : null;
    if (filterConfig && filterConfig.enabled !== undefined) {
      return Boolean(filterConfig.enabled);
    }
    if (column.filterable === false || column.filterEnabled === false) {
      return false;
    }
    if (column.filterable === true || column.filterEnabled === true) {
      return true;
    }
    return undefined;
  }

  function registerColumnDefinition(columnConfig) {
    if (!columnConfig || !columnConfig.key) {
      return;
    }
    const existing = columnRegistry.get(columnConfig.key) || {
      key: columnConfig.key,
      label: columnConfig.label,
      explicitType: columnConfig.filterType || null,
      values: new Map(),
      numericCount: 0,
      totalCount: 0,
      filterEnabled: true,
    };
    if (!existing.label && columnConfig.label) {
      existing.label = columnConfig.label;
    }
    if (columnConfig.filterType && !existing.explicitType) {
      existing.explicitType = columnConfig.filterType;
    }
    if (columnConfig.filterEnabled === false) {
      existing.filterEnabled = false;
    }
    if (columnConfig.description && !existing.description) {
      existing.description = columnConfig.description;
    }
    columnRegistry.set(columnConfig.key, existing);
  }

  function registerColumnValue(columnConfig, metadata) {
    if (!columnConfig || !columnConfig.key) {
      return;
    }
    const entry = columnRegistry.get(columnConfig.key);
    if (!entry) {
      return;
    }
    entry.totalCount += 1;
    if (metadata && metadata.number != null && !Number.isNaN(metadata.number)) {
      entry.numericCount += 1;
    }
    if (metadata && metadata.normalisedText) {
      const normalised = metadata.normalisedText;
      if (!entry.values.has(normalised)) {
        entry.values.set(normalised, metadata.text || metadata.normalisedText);
      }
    }
  }

    function registerSectionMetadata(key, label, metadata = {}) {
      if (!key) {
        return;
      }
      const existing = sectionRegistry.get(key) || {
        key,
        label: label || key,
        elements: new Set(),
        navElements: new Set(),
      };
    const resolvedLabel = label && String(label).trim() ? String(label).trim() : '';
    if (resolvedLabel) {
      existing.label = resolvedLabel;
    } else if (!existing.label) {
      existing.label = existing.key;
    }

    if (metadata.order != null && Number.isFinite(metadata.order)) {
      existing.order = metadata.order;
    }

    if (metadata.depth != null && Number.isFinite(metadata.depth)) {
      existing.depth = metadata.depth;
    }

    if (metadata.parentKey !== undefined) {
      existing.parentKey = metadata.parentKey;
    }

    if (metadata.type) {
      existing.type = metadata.type;
    }

    if (metadata.sectionIndex != null && Number.isFinite(metadata.sectionIndex)) {
      existing.sectionIndex = metadata.sectionIndex;
    }

    if (metadata.hasStandaloneContent !== undefined) {
      existing.hasStandaloneContent = Boolean(metadata.hasStandaloneContent);
    }

    if (Array.isArray(metadata.elements)) {
      metadata.elements.filter(Boolean).forEach((element) => existing.elements.add(element));
    }

      if (Array.isArray(metadata.navElements)) {
        metadata.navElements.filter(Boolean).forEach((element) => existing.navElements.add(element));
      }

      sectionRegistry.set(key, existing);
    }

  function resolveHeadingElements(heading) {
    if (!heading) {
      return [];
    }
    if (heading.classList.contains('combo-section__header')) {
      const comboSection = heading.closest('.combo-section');
      return comboSection ? [comboSection] : [heading];
    }
    if (heading.classList.contains('citizen-subsection-heading')) {
      const wrapper = heading.closest('.citizen-subsection');
      return wrapper ? [wrapper] : [heading];
    }
    if (heading.classList.contains('citizen-section-heading')) {
      const elements = [];
      const spacing = heading.previousElementSibling;
      if (spacing && spacing.classList && spacing.classList.contains('section-spacing')) {
        elements.push(spacing);
      }
      elements.push(heading);
      const content = heading.nextElementSibling;
      if (content && content.matches && content.matches('section.citizen-section')) {
        elements.push(content);
      }
      return elements;
    }
    return [heading];
  }

  function resolveSectionNavigationElements(sectionKey) {
    if (typeof document === 'undefined' || !sectionKey) {
      return [];
    }
    const elements = [];
    const navItem = document.getElementById(`toc-${sectionKey}`);
    if (navItem) {
      elements.push(navItem);
    }
    return elements;
  }

  function ensureTocObserver() {
    if (tocObserver || typeof MutationObserver === 'undefined' || typeof document === 'undefined') {
      return;
    }
    const tocList = document.getElementById('mw-panel-toc-list');
    if (!tocList) {
      return;
    }
    tocObserver = new MutationObserver(() => {
      refreshNavigationElements();
      updateSectionVisibility();
    });
    tocObserver.observe(tocList, { childList: true, subtree: true });
  }

  function resolveHeadingKey(heading, fallbackIndex) {
    if (!heading) {
      return `section-${fallbackIndex}`;
    }
    if (heading.dataset && heading.dataset.sectionKey) {
      return heading.dataset.sectionKey;
    }
    const parentWithKey = heading.closest('[data-section-key]');
    if (parentWithKey && parentWithKey.dataset.sectionKey) {
      return parentWithKey.dataset.sectionKey;
    }
    const headline = heading.querySelector && heading.querySelector('.mw-headline');
    if (headline && headline.id) {
      return headline.id;
    }
    if (heading.id) {
      return heading.id;
    }
    return `section-${fallbackIndex}`;
  }

  function hasStandaloneSectionContent(heading) {
    if (!heading || typeof document === 'undefined') {
      return false;
    }

    let container = null;
    if (heading.classList.contains('citizen-subsection-heading')) {
      container = heading.closest('.citizen-subsection');
    } else {
      const content = heading.nextElementSibling;
      if (content && content.matches && content.matches('section.citizen-section')) {
        container = content;
      }
    }

    if (!container) {
      return false;
    }

    const TEXT_NODE = typeof Node !== 'undefined' ? Node.TEXT_NODE : 3;
    const ELEMENT_NODE = typeof Node !== 'undefined' ? Node.ELEMENT_NODE : 1;

    return Array.from(container.childNodes || []).some((node) => {
      if (node.nodeType === TEXT_NODE) {
        return node.textContent && node.textContent.trim();
      }
      if (node.nodeType !== ELEMENT_NODE) {
        return false;
      }
      const element = node;
      if (element.matches && element.matches('h3.citizen-subsection-heading, .citizen-subsection')) {
        return false;
      }
      return element.textContent && element.textContent.trim();
    });
  }

  function registerPageSectionsFromDom() {
    if (typeof document === 'undefined') {
      return;
    }
    const selector =
      'h2.citizen-section-heading, h3.citizen-subsection-heading, h3.combo-section__header';
    const headings = document.querySelectorAll(selector);
    if (!headings.length) {
      return;
    }
    const stack = [];
    let order = 0;
    headings.forEach((heading, index) => {
      const level = Number.parseInt(heading.tagName.replace(/[^0-9]/g, ''), 10) || 0;
      if (!level) {
        return;
      }
      const depth = Math.max(0, level - 2);
      while (stack.length && stack[stack.length - 1].level >= level) {
        stack.pop();
      }
      const parentKey = stack.length ? stack[stack.length - 1].key : undefined;
        const key = resolveHeadingKey(heading, index);
        const headline = heading.querySelector('.mw-headline');
        const label = headline && headline.textContent ? headline.textContent.trim() : heading.textContent.trim();
        const elements = resolveHeadingElements(heading);
        const navElements = resolveSectionNavigationElements(key);
        const type = heading.classList.contains('combo-section__header') ? 'combo' : 'page';
        const hasStandaloneContent = type === 'combo' ? true : hasStandaloneSectionContent(heading);
        registerSectionMetadata(key, label, {
          order,
          depth,
          parentKey,
          type,
          elements,
          navElements,
          hasStandaloneContent,
        });
      stack.push({ key, level });
      order += 1;
    });
    ensureTocObserver();
  }

  function resetColumnMetadata() {
    columnRegistry.clear();
    sectionRegistry.clear();
    tableMetadataList = [];
    tableMetadataMap = new WeakMap();
  }

  function finaliseColumnRegistry() {
    columnRegistry.forEach((entry) => {
      if (entry.explicitType) {
        entry.type = entry.explicitType;
      } else if (entry.totalCount && entry.numericCount === entry.totalCount) {
        entry.type = 'number';
      } else if (entry.values.size && entry.values.size <= 15) {
        entry.type = 'enum';
      } else {
        entry.type = 'text';
      }

      if (entry.type === 'enum') {
        entry.enumValues = Array.from(entry.values.entries()).map(([value, label]) => ({ value, label }));
        entry.enumValues.sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: 'base' }));
      }
    });
  }

  function pruneFilterState() {
    if (!filterState) {
      return;
    }
    const hiddenColumns = filterState.hiddenColumns || new Set();
    filterState.hiddenColumns = new Set(
      Array.from(hiddenColumns).filter((columnKey) => columnRegistry.has(columnKey)),
    );
    const hiddenSections = filterState.hiddenSections || new Set();
    filterState.hiddenSections = new Set(
      Array.from(hiddenSections).filter((sectionKey) => sectionRegistry.has(sectionKey)),
    );
    const conditions = filterState.columnConditions || {};
    Object.keys(conditions).forEach((columnKey) => {
      const column = columnRegistry.get(columnKey);
      if (!column || column.filterEnabled === false) {
        delete conditions[columnKey];
      }
    });
  }

  function stripLinkSyntax(text) {
    if (!text) {
      return text;
    }
    return String(text).replace(/\(([^|()]+)\|([^\)]+)\)/g, (match, label) =>
      label != null ? String(label).trim() : match,
    );
  }

  function resolveCellText(value, html) {
    if (value == null) {
      return html ? extractTextContent(html) : '';
    }
    if (typeof value === 'string' || typeof value === 'number') {
      return stripLinkSyntax(String(value));
    }
    if (typeof value === 'object') {
      if (value.text != null) {
        return stripLinkSyntax(String(value.text));
      }
      if (value.value != null) {
        return stripLinkSyntax(String(value.value));
      }
      if (typeof value.html === 'string') {
        return extractTextContent(value.html);
      }
    }
    if (html) {
      return extractTextContent(html);
    }
    return '';
  }

  function parseNumericValue(value, html) {
    const text = resolveCellText(value, html).replace(/,/g, '');
    const match = text.match(/-?\d+(?:\.\d+)?/);
    if (!match) {
      return null;
    }
    const numericValue = Number(match[0]);
    return Number.isNaN(numericValue) ? null : numericValue;
  }

  function normaliseTokens(text) {
    if (!text) {
      return [];
    }
    return text
      .split(/[,/]|\s>\s|>\s|\s>/g)
      .map((token) => token.trim().toLowerCase())
      .filter((token) => token);
  }

  function normaliseCellValueForFilter(value, html, columnConfig) {
    const text = resolveCellText(value, html).trim();
    const normalisedText = text.toLowerCase();
    const isNumericColumn =
      columnConfig &&
      (columnConfig.filterType === 'number' || (columnConfig.sort && columnConfig.sort.type === 'number'));
    const number = isNumericColumn ? parseNumericValue(value, html) : null;
    const tokens = normaliseTokens(text);
    return {
      text,
      normalisedText,
      number,
      tokens: tokens.length ? tokens : normalisedText ? [normalisedText] : [],
    };
  }

  function getConditionValueSet(condition) {
    if (!condition || !Array.isArray(condition.values)) {
      return new Set();
    }
    if (condition._valueSet && condition._valueSetSource === condition.values) {
      return condition._valueSet;
    }
    const set = new Set(condition.values);
    Object.defineProperty(condition, '_valueSet', { value: set, enumerable: false, configurable: true });
    Object.defineProperty(condition, '_valueSetSource', {
      value: condition.values,
      enumerable: false,
      configurable: true,
    });
    return set;
  }

  function matchesNumberCondition(valueMetadata, condition) {
    if (!condition || typeof condition.value !== 'number') {
      return true;
    }
    if (!valueMetadata || valueMetadata.number == null) {
      return false;
    }
    const value = valueMetadata.number;
    switch (condition.operator) {
      case 'lte':
        return value <= condition.value;
      case 'eq':
        return value === condition.value;
      case 'gte':
      default:
        return value >= condition.value;
    }
  }

  function matchesTextCondition(valueMetadata, condition) {
    if (!condition || !condition.value) {
      return true;
    }
    const haystack = (valueMetadata && valueMetadata.normalisedText) || '';
    const needle = String(condition.value).trim().toLowerCase();
    if (!needle) {
      return true;
    }
    switch (condition.mode) {
      case 'equals':
        return haystack === needle;
      case 'starts-with':
        return haystack.startsWith(needle);
      case 'ends-with':
        return haystack.endsWith(needle);
      case 'not-contains':
        return !haystack.includes(needle);
      case 'contains':
      default:
        return haystack.includes(needle);
    }
  }

  function matchesEnumCondition(valueMetadata, condition) {
    if (!condition || !Array.isArray(condition.values) || !condition.values.length) {
      return true;
    }
    const tokens =
      (valueMetadata && Array.isArray(valueMetadata.tokens) && valueMetadata.tokens.length
        ? valueMetadata.tokens
        : valueMetadata && valueMetadata.normalisedText
        ? [valueMetadata.normalisedText]
        : []) || [];
    const valueSet = getConditionValueSet(condition);
    const hasMatch = tokens.some((token) => valueSet.has(token));
    if (condition.mode === 'exclude') {
      return !hasMatch;
    }
    return hasMatch;
  }

  function matchesCondition(valueMetadata, condition) {
    if (!condition || typeof condition !== 'object') {
      return true;
    }
    if (condition.type === 'number') {
      return matchesNumberCondition(valueMetadata, condition);
    }
    if (condition.type === 'enum') {
      return matchesEnumCondition(valueMetadata, condition);
    }
    return matchesTextCondition(valueMetadata, condition);
  }

  function rowMatchesConditions(rowMetadata) {
    const conditions = filterState.columnConditions || {};
    const entries = Object.entries(conditions);
      for (let index = 0; index < entries.length; index += 1) {
        const [columnKey, condition] = entries[index];
        if (!condition) {
          continue;
        }
        const column = columnRegistry.get(columnKey);
        if (!column || column.filterEnabled === false) {
          continue;
        }
        const valueMetadata = rowMetadata && rowMetadata.values ? rowMetadata.values[columnKey] : null;
        if (!matchesCondition(valueMetadata, condition)) {
          return false;
        }
      }
    return true;
  }

  function hasActiveFilters() {
    const columnFilters = filterState.columnConditions
      ? Object.keys(filterState.columnConditions).filter((key) => filterState.columnConditions[key]).length > 0
      : false;
    return (
      columnFilters ||
      filterState.hiddenColumns.size > 0 ||
      filterState.hiddenSections.size > 0 ||
      Boolean(filterState.hideEmptySections)
    );
  }

  function applyColumnVisibility() {
    if (!comboRoot) {
      return;
    }
    columnRegistry.forEach((entry) => {
      const cells = comboRoot.querySelectorAll(`[data-column-key="${entry.key}"]`);
      const hidden = filterState.hiddenColumns.has(entry.key);
      cells.forEach((cell) => {
        if (hidden) {
          cell.setAttribute('data-column-hidden', 'true');
        } else {
          cell.removeAttribute('data-column-hidden');
        }
      });
    });
  }

  function setElementFilterHidden(element, hidden) {
    if (!element) {
      return;
    }
    if (hidden) {
      element.setAttribute('data-filter-hidden', 'true');
    } else {
      element.removeAttribute('data-filter-hidden');
    }
  }

  function refreshNavigationElements() {
    sectionRegistry.forEach((entry) => {
      if (!entry || !entry.key) {
        return;
      }
      const resolvedNavElements = resolveSectionNavigationElements(entry.key) || [];
      if (!resolvedNavElements.length) {
        return;
      }
      entry.navElements = new Set(resolvedNavElements);
    });
  }

  function sectionHasHiddenAncestor(sectionKey) {
    if (!sectionKey) {
      return false;
    }
    let current = sectionRegistry.get(sectionKey);
    const visited = new Set();
    while (current && current.parentKey && !visited.has(current.parentKey)) {
      const parentKey = current.parentKey;
      if (latestSectionVisibility.has(parentKey)) {
        if (latestSectionVisibility.get(parentKey)) {
          return true;
        }
      } else if (filterState.hiddenSections.has(parentKey)) {
        return true;
      }
      visited.add(parentKey);
      current = sectionRegistry.get(parentKey);
    }
    return false;
  }

  function countVisibleRowsBySection() {
    const counts = new Map();
    tableMetadataList.forEach((metadata) => {
      const sectionKey = metadata.sectionKey;
      if (!sectionKey) {
        return;
      }
      let visibleRows = metadata.visibleRowCount;
      if (typeof visibleRows !== 'number') {
        const fallbackRows = Array.from(
          metadata.element.querySelectorAll('tbody tr:not(.combo-table__empty-row)'),
        ).filter((row) => !row.hidden).length;
        visibleRows = fallbackRows;
      }
      counts.set(sectionKey, (counts.get(sectionKey) || 0) + visibleRows);
    });
    return counts;
  }

  function updateSectionVisibility() {
    const shouldHideEmpty = Boolean(filterState.hideEmptySections);
    const visibleRowCounts = shouldHideEmpty ? countVisibleRowsBySection() : new Map();
    ensureTocObserver();
    refreshNavigationElements();
    const sections = Array.from(sectionRegistry.values());
    if (!sections.length) {
      latestSectionVisibility = new Map();
      return;
    }

    const childrenByParent = new Map();
    sections.forEach((entry) => {
      if (entry.parentKey) {
        if (!childrenByParent.has(entry.parentKey)) {
          childrenByParent.set(entry.parentKey, []);
        }
        childrenByParent.get(entry.parentKey).push(entry);
      }
    });

    const sectionsByDepth = [...sections].sort(
      (left, right) => (left.depth || 0) - (right.depth || 0),
    );

    const baseHidden = new Map();
    sectionsByDepth.forEach((entry) => {
      let hidden = filterState.hiddenSections.has(entry.key);
      if (!hidden && shouldHideEmpty && entry.type === 'combo') {
        const visibleRows = visibleRowCounts.get(entry.key) || 0;
        hidden = visibleRows === 0;
      }
      baseHidden.set(entry.key, hidden);
    });

    const effectiveHidden = new Map();
    sectionsByDepth.forEach((entry) => {
      const parentHidden = entry.parentKey ? effectiveHidden.get(entry.parentKey) : false;
      effectiveHidden.set(entry.key, baseHidden.get(entry.key) || Boolean(parentHidden));
    });

    [...sectionsByDepth].reverse().forEach((entry) => {
      if (effectiveHidden.get(entry.key)) {
        return;
      }
      const children = childrenByParent.get(entry.key) || [];
      if (!children.length) {
        return;
      }
      if (entry.hasStandaloneContent) {
        return;
      }
      const allChildrenHidden = children.every((child) => effectiveHidden.get(child.key));
      if (allChildrenHidden) {
        effectiveHidden.set(entry.key, true);
      }
    });

    latestSectionVisibility = effectiveHidden;

    sections.forEach((entry) => {
      const elements = entry.elements ? Array.from(entry.elements).filter(Boolean) : [];
      const navElements = entry.navElements ? Array.from(entry.navElements).filter(Boolean) : [];
      if (!elements.length && !navElements.length) {
        return;
      }
      const hidden = effectiveHidden.get(entry.key);
      const targets = elements.concat(navElements);
      targets.forEach((element) => setElementFilterHidden(element, hidden));
    });
  }

  function applyFilters() {
    if (!tableMetadataList.length) {
      updateSectionVisibility();
      return;
    }

    tableMetadataList.forEach((metadata) => {
      let visibleCount = 0;
      (metadata.rows || []).forEach((row) => {
        const matches = rowMatchesConditions(row);
        if (row.element) {
          if (!matches) {
            row.element.setAttribute('hidden', 'true');
          } else {
            row.element.removeAttribute('hidden');
          }
        }
        if (matches) {
          visibleCount += 1;
        }
      });
      if (metadata.emptyRow) {
        metadata.emptyRow.hidden = visibleCount !== 0;
      }
      metadata.visibleRowCount = visibleCount;
    });

    updateSectionVisibility();
  }

  function updateFilterButtonState() {
    if (!filterInterface || !filterInterface.button) {
      return;
    }
    filterInterface.button.classList.toggle('combo-filter-button--active', hasActiveFilters());
  }

  function setColumnHidden(columnKey, hidden) {
    if (!columnKey) {
      return;
    }
    if (hidden) {
      filterState.hiddenColumns.add(columnKey);
    } else {
      filterState.hiddenColumns.delete(columnKey);
    }
    persistFilterState();
    applyColumnVisibility();
    updateFilterButtonState();
  }

  function setSectionHidden(sectionKey, hidden) {
    if (!sectionKey || !sectionRegistry.has(sectionKey)) {
      return;
    }
    if (hidden) {
      filterState.hiddenSections.add(sectionKey);
    } else {
      filterState.hiddenSections.delete(sectionKey);
    }
      persistFilterState();
      updateSectionVisibility();
      updateFilterButtonState();
      syncFilterUi();
    }

  function setColumnCondition(columnKey, condition) {
    if (!columnKey) {
      return;
    }
    const column = columnRegistry.get(columnKey);
    if (!column || column.filterEnabled === false) {
      if (filterState.columnConditions[columnKey]) {
        delete filterState.columnConditions[columnKey];
        persistFilterState();
        applyFilters();
        updateFilterButtonState();
      }
      return;
    }
    const normalised = cloneCondition(condition);
    if (normalised) {
      filterState.columnConditions[columnKey] = normalised;
    } else {
      delete filterState.columnConditions[columnKey];
    }
    persistFilterState();
    applyFilters();
    updateFilterButtonState();
  }

  function syncFilterUi() {
    columnUiState.forEach((entry, columnKey) => {
      if (entry.visibilityCheckbox) {
        entry.visibilityCheckbox.checked = !filterState.hiddenColumns.has(columnKey);
      }
      if (entry.conditionControl && typeof entry.conditionControl.update === 'function') {
        entry.conditionControl.update(filterState.columnConditions[columnKey]);
      }
    });
      sectionUiState.forEach((entry, sectionKey) => {
        if (entry.visibilityCheckbox) {
          entry.visibilityCheckbox.checked = !filterState.hiddenSections.has(sectionKey);
          const ancestorHidden = sectionHasHiddenAncestor(sectionKey);
          entry.visibilityCheckbox.disabled = ancestorHidden;
          if (entry.container) {
            entry.container.classList.toggle('combo-filter-section-option--disabled', ancestorHidden);
          }
        }
      });
    if (filterInterface && filterInterface.hideEmptyCheckbox) {
      filterInterface.hideEmptyCheckbox.checked = Boolean(filterState.hideEmptySections);
    }
    updateFilterButtonState();
  }

  function resetFilters() {
    if (defaultPresetValue) {
      applyPresetFromValue(defaultPresetValue);
      if (filterInterface && filterInterface.presetSelect) {
        filterInterface.presetSelect.value = defaultPresetValue;
        filterInterface.selectedPresetValue = defaultPresetValue;
        if (filterInterface.deletePresetButton) {
          filterInterface.deletePresetButton.disabled = true;
        }
      }
      return;
    }
    filterState = createDefaultFilterState();
    persistFilterState();
    applyColumnVisibility();
    applyFilters();
    syncFilterUi();
  }

  function applyPresetState(state) {
    if (!state) {
      return;
    }
    const nextState = cloneFilterState(state);
    nextState.hiddenColumns = new Set(
      Array.from(nextState.hiddenColumns || []).filter((columnKey) => columnRegistry.has(columnKey)),
    );
    nextState.hiddenSections = new Set(
      Array.from(nextState.hiddenSections || []).filter((sectionKey) => sectionRegistry.has(sectionKey)),
    );
    Object.keys(nextState.columnConditions).forEach((columnKey) => {
      const column = columnRegistry.get(columnKey);
      if (!column || column.filterEnabled === false) {
        delete nextState.columnConditions[columnKey];
      }
    });
    filterState = nextState;
    pruneFilterState();
    persistFilterState();
    applyColumnVisibility();
    applyFilters();
    syncFilterUi();
  }

  function applyPresetFromValue(value) {
    if (!value) {
      return;
    }
      if (value.startsWith('built-in:')) {
        const key = value.slice('built-in:'.length);
        const preset = builtInPresets.find((entry) => entry.key === key);
        if (preset) {
          applyPresetState(preset.state);
        }
        return;
      }
    if (value.startsWith('custom:')) {
      const key = value.slice('custom:'.length);
      const preset = customPresets.find((entry) => entry.key === key);
      if (preset) {
        applyPresetState(preset.state);
      }
    }
  }

  function deleteCustomPresetByKey(key) {
    if (!key) {
      return;
    }
    const index = customPresets.findIndex((preset) => preset.key === key);
    if (index === -1) {
      return;
    }
    customPresets.splice(index, 1);
    persistCustomPresets();
    renderPresetOptions();
  }

  function saveCustomPresetFromState() {
    if (typeof window === 'undefined' || typeof window.prompt !== 'function') {
      return;
    }
    const name = window.prompt('Preset name');
    if (!name || !name.trim()) {
      return;
    }
    const preset = {
      key: `preset-${Date.now()}`,
      name: name.trim(),
      description: '',
      state: cloneFilterState(filterState),
    };
    customPresets.push(preset);
    persistCustomPresets();
    renderPresetOptions();
    if (filterInterface && filterInterface.presetSelect) {
      const value = `custom:${preset.key}`;
      filterInterface.presetSelect.value = value;
      filterInterface.selectedPresetValue = value;
      if (filterInterface.deletePresetButton) {
        filterInterface.deletePresetButton.disabled = false;
      }
    }
  }

  function renderPresetOptions() {
    if (!filterInterface || !filterInterface.presetSelect) {
      return;
    }
    const select = filterInterface.presetSelect;
    const previousValue = filterInterface.selectedPresetValue || '';
    const desiredValue = previousValue || defaultPresetValue || '';
    select.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Choose a preset';
    placeholder.disabled = true;
    placeholder.selected = !desiredValue;
    select.appendChild(placeholder);

      if (builtInPresets.length) {
        const builtInGroup = document.createElement('optgroup');
        builtInGroup.label = 'Built-in presets';
        builtInPresets.forEach((preset) => {
          const option = document.createElement('option');
          option.value = `built-in:${preset.key}`;
          option.textContent = preset.name;
          if (preset.description) {
            option.title = preset.description;
          }
          builtInGroup.appendChild(option);
        });
        select.appendChild(builtInGroup);
      }

    if (customPresets.length) {
        const customGroup = document.createElement('optgroup');
        customGroup.label = 'Custom presets';
        customPresets.forEach((preset) => {
          const option = document.createElement('option');
          option.value = `custom:${preset.key}`;
          option.textContent = preset.name;
          if (preset.description) {
            option.title = preset.description;
          }
          customGroup.appendChild(option);
        });
        select.appendChild(customGroup);
      }

      const resolvedValue = desiredValue && select.querySelector(`option[value="${desiredValue}"]`)
        ? desiredValue
        : '';

      select.value = resolvedValue;
      filterInterface.selectedPresetValue = resolvedValue;
      placeholder.selected = resolvedValue === '';

      if (filterInterface.deletePresetButton) {
        filterInterface.deletePresetButton.disabled = !(
          filterInterface.selectedPresetValue && filterInterface.selectedPresetValue.startsWith('custom:')
        );
      }
    }

    function createNumberConditionControl(column) {
      const details = document.createElement('details');
      details.className = 'combo-filter-condition';
      const summary = document.createElement('summary');
      summary.textContent = column.label;
      applyTooltip(summary, column.description);
      details.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'combo-filter-condition__body';
    const row = document.createElement('div');
    row.className = 'combo-filter-condition__row';

    const select = document.createElement('select');
    [
      { value: 'gte', label: '≥' },
      { value: 'lte', label: '≤' },
      { value: 'eq', label: '=' },
    ].forEach((option) => {
      const element = document.createElement('option');
      element.value = option.value;
      element.textContent = option.label;
      select.appendChild(element);
    });

    const input = document.createElement('input');
    input.type = 'number';
    input.step = 'any';
    row.appendChild(select);
    row.appendChild(input);

    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.textContent = 'Clear';
    clearButton.addEventListener('click', (event) => {
      event.preventDefault();
      input.value = '';
      setColumnCondition(column.key, null);
      details.open = false;
    });

    const handleChange = () => {
      if (input.value === '') {
        setColumnCondition(column.key, null);
        return;
      }
      const value = Number(input.value);
      if (Number.isNaN(value)) {
        return;
      }
      setColumnCondition(column.key, { type: 'number', operator: select.value || 'gte', value });
    };

    select.addEventListener('change', handleChange);
    input.addEventListener('input', handleChange);

    body.appendChild(row);
    body.appendChild(clearButton);
    details.appendChild(body);

    return {
      element: details,
      update: (condition) => {
        if (condition && condition.type === 'number') {
          select.value = condition.operator || 'gte';
          input.value = condition.value != null ? condition.value : '';
          details.open = true;
        } else {
          select.value = 'gte';
          input.value = '';
          details.open = false;
        }
      },
    };
  }

    function createTextConditionControl(column) {
      const details = document.createElement('details');
      details.className = 'combo-filter-condition';
      const summary = document.createElement('summary');
      summary.textContent = column.label;
      applyTooltip(summary, column.description);
      details.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'combo-filter-condition__body';
    const row = document.createElement('div');
    row.className = 'combo-filter-condition__row';

    const select = document.createElement('select');
    [
      { value: 'contains', label: 'Contains' },
      { value: 'not-contains', label: 'Does not contain' },
      { value: 'starts-with', label: 'Starts with' },
      { value: 'ends-with', label: 'Ends with' },
      { value: 'equals', label: 'Matches exactly' },
    ].forEach((option) => {
      const element = document.createElement('option');
      element.value = option.value;
      element.textContent = option.label;
      select.appendChild(element);
    });

    const input = document.createElement('input');
    input.type = 'text';
    row.appendChild(select);
    row.appendChild(input);

    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.textContent = 'Clear';
    clearButton.addEventListener('click', (event) => {
      event.preventDefault();
      input.value = '';
      setColumnCondition(column.key, null);
      details.open = false;
    });

    const handleChange = () => {
      const value = input.value.trim();
      if (!value) {
        setColumnCondition(column.key, null);
        return;
      }
      setColumnCondition(column.key, { type: 'text', mode: select.value || 'contains', value });
    };

    select.addEventListener('change', handleChange);
    input.addEventListener('input', handleChange);

    body.appendChild(row);
    body.appendChild(clearButton);
    details.appendChild(body);

    return {
      element: details,
      update: (condition) => {
        if (condition && condition.type === 'text') {
          select.value = condition.mode || 'contains';
          input.value = condition.value || '';
          details.open = Boolean(condition.value);
        } else {
          select.value = 'contains';
          input.value = '';
          details.open = false;
        }
      },
    };
  }

    function createEnumConditionControl(column) {
      const details = document.createElement('details');
      details.className = 'combo-filter-condition';
      const summary = document.createElement('summary');
      summary.textContent = column.label;
      applyTooltip(summary, column.description);
      details.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'combo-filter-condition__body';
    const modeRow = document.createElement('div');
    modeRow.className = 'combo-filter-condition__row';
    const modeSelect = document.createElement('select');
    [
      { value: 'include', label: 'Show only selected' },
      { value: 'exclude', label: 'Hide selected' },
    ].forEach((option) => {
      const element = document.createElement('option');
      element.value = option.value;
      element.textContent = option.label;
      modeSelect.appendChild(element);
    });
    modeRow.appendChild(modeSelect);

    const optionsContainer = document.createElement('div');
    optionsContainer.className = 'combo-filter-enum-options';
    (column.enumValues || []).forEach((entry) => {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = entry.value;
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(entry.label));
      optionsContainer.appendChild(label);
    });

    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.textContent = 'Clear';
    clearButton.addEventListener('click', (event) => {
      event.preventDefault();
      optionsContainer.querySelectorAll('input[type="checkbox"]').forEach((inputElement) => {
        inputElement.checked = false;
      });
      setColumnCondition(column.key, null);
      details.open = false;
    });

    const applySelection = () => {
      const selected = Array.from(optionsContainer.querySelectorAll('input[type="checkbox"]:checked')).map(
        (inputElement) => inputElement.value,
      );
      if (!selected.length) {
        setColumnCondition(column.key, null);
        return;
      }
      setColumnCondition(column.key, { type: 'enum', mode: modeSelect.value || 'include', values: selected });
    };

    optionsContainer.addEventListener('change', applySelection);
    modeSelect.addEventListener('change', applySelection);

    body.appendChild(modeRow);
    body.appendChild(optionsContainer);
    body.appendChild(clearButton);
    details.appendChild(body);

    return {
      element: details,
      update: (condition) => {
        if (condition && condition.type === 'enum') {
          modeSelect.value = condition.mode || 'include';
          const values = new Set(condition.values || []);
          optionsContainer.querySelectorAll('input[type="checkbox"]').forEach((inputElement) => {
            inputElement.checked = values.has(inputElement.value);
          });
          details.open = values.size > 0;
        } else {
          modeSelect.value = 'include';
          optionsContainer.querySelectorAll('input[type="checkbox"]').forEach((inputElement) => {
            inputElement.checked = false;
          });
          details.open = false;
        }
      },
    };
  }

  function createConditionControl(column) {
    if (column.type === 'number') {
      return createNumberConditionControl(column);
    }
    if (column.type === 'enum' && Array.isArray(column.enumValues) && column.enumValues.length) {
      return createEnumConditionControl(column);
    }
    return createTextConditionControl(column);
  }

  function renderFilterControls() {
    if (!filterInterface) {
      return;
    }
    columnUiState.clear();
    sectionUiState.clear();
    const sections = Array.from(sectionRegistry.values()).sort((left, right) => {
      const leftOrder = left.order != null ? left.order : Number.MAX_SAFE_INTEGER;
      const rightOrder = right.order != null ? right.order : Number.MAX_SAFE_INTEGER;
      if (leftOrder === rightOrder) {
        return (left.label || '').localeCompare(right.label || '', undefined, { sensitivity: 'base' });
      }
      return leftOrder - rightOrder;
    });
    const columns = Array.from(columnRegistry.values());
    const filterableColumns = columns.filter((column) => column.filterEnabled !== false);

    if (filterInterface.sectionVisibilityContainer) {
      filterInterface.sectionVisibilityContainer.innerHTML = '';
        if (!sections.length) {
          const notice = document.createElement('p');
          notice.textContent = 'Sections will appear once combo data loads.';
          filterInterface.sectionVisibilityContainer.appendChild(notice);
        } else {
          sections.forEach((section) => {
            const label = document.createElement('label');
            label.className = 'combo-filter-section-option';
            const depth = Number.isFinite(section.depth) ? section.depth : 0;
            label.style.setProperty('--section-depth', String(depth));
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = !filterState.hiddenSections.has(section.key);
            checkbox.addEventListener('change', () => {
              setSectionHidden(section.key, !checkbox.checked);
            });
            label.appendChild(checkbox);
            const labelText = document.createElement('span');
            labelText.className = 'combo-filter-section-option__label';
            labelText.textContent = section.label || section.key;
            label.appendChild(labelText);
            const note = document.createElement('span');
            note.className = 'combo-filter-section-option__note';
            note.textContent = 'Enable parent section to edit';
            label.appendChild(note);
            filterInterface.sectionVisibilityContainer.appendChild(label);

            sectionUiState.set(section.key, {
              visibilityCheckbox: checkbox,
              container: label,
              parentKey: section.parentKey,
            });
          });
        }
      }

    if (filterInterface.visibilityContainer) {
      filterInterface.visibilityContainer.innerHTML = '';
      if (!columns.length) {
        const notice = document.createElement('p');
        notice.textContent = 'Columns will appear once combo data loads.';
        filterInterface.visibilityContainer.appendChild(notice);
      } else {
          columns.forEach((column) => {
            const label = document.createElement('label');
            applyTooltip(label, column.description);
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = !filterState.hiddenColumns.has(column.key);
          checkbox.addEventListener('change', () => {
            setColumnHidden(column.key, !checkbox.checked);
          });
          label.appendChild(checkbox);
          label.appendChild(document.createTextNode(column.label));
          filterInterface.visibilityContainer.appendChild(label);

          const entry = columnUiState.get(column.key) || {};
          entry.visibilityCheckbox = checkbox;
          columnUiState.set(column.key, entry);
        });
      }
    }

    if (filterInterface.conditionsContainer) {
      filterInterface.conditionsContainer.innerHTML = '';
      if (!filterableColumns.length) {
        const notice = document.createElement('p');
        notice.textContent = 'No columns available for filtering.';
        filterInterface.conditionsContainer.appendChild(notice);
      } else {
        filterableColumns.forEach((column) => {
          const control = createConditionControl(column);
          if (!control) {
            return;
          }
          filterInterface.conditionsContainer.appendChild(control.element);
          const entry = columnUiState.get(column.key) || {};
          entry.conditionControl = control;
          columnUiState.set(column.key, entry);
        });
      }
    }

    renderPresetOptions();
    syncFilterUi();
  }

  function toggleFilterPanel(forceState) {
    if (!filterInterface || !filterInterface.overlay || !filterInterface.button) {
      return;
    }
    const shouldOpen = forceState == null ? filterInterface.overlay.hidden : Boolean(forceState);
    filterInterface.overlay.hidden = !shouldOpen;
    filterInterface.button.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
    isFilterPanelOpen = shouldOpen;
    if (shouldOpen) {
      document.body.classList.add('combo-filter-open');
      if (filterInterface.panel) {
        filterInterface.panel.focus();
      }
    } else {
      document.body.classList.remove('combo-filter-open');
    }
  }

  function createCollapsibleFilterSection(title) {
    const section = document.createElement('section');
    section.className = 'combo-filter-panel__section';
    const heading = document.createElement('h3');
    heading.className = 'combo-filter-panel__section-heading';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'combo-filter-panel__section-toggle';
    toggle.setAttribute('aria-expanded', 'true');
    const label = document.createElement('span');
    label.className = 'combo-filter-panel__section-label';
    label.textContent = title;
    const icon = document.createElement('span');
    icon.className = 'combo-filter-panel__section-toggle-icon';
    icon.setAttribute('aria-hidden', 'true');
    toggle.appendChild(label);
    toggle.appendChild(icon);
    heading.appendChild(toggle);
    const body = document.createElement('div');
    body.className = 'combo-filter-panel__section-body';
    section.appendChild(heading);
    section.appendChild(body);
      const setOpen = (open) => {
        const isOpen = Boolean(open);
        toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        body.hidden = !isOpen;
        if (isOpen) {
          section.classList.remove('combo-filter-panel__section--collapsed');
        } else {
          section.classList.add('combo-filter-panel__section--collapsed');
        }
      };
    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      setOpen(!expanded);
    });
    setOpen(false);
    return { section, body, toggle, setOpen };
  }

  function ensureFilterInterface() {
    if (filterInterface || typeof document === 'undefined' || !document.body) {
      return;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'combo-filter-button';
    button.textContent = 'Filters';
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', 'false');

    const overlay = document.createElement('div');
    overlay.className = 'combo-filter-overlay';
    overlay.hidden = true;

    const panel = document.createElement('div');
    panel.className = 'combo-filter-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Combo Filters');
    panel.tabIndex = -1;

    overlay.appendChild(panel);
    document.body.appendChild(button);
    document.body.appendChild(overlay);

    const header = document.createElement('div');
    header.className = 'combo-filter-panel__header';
    const title = document.createElement('h2');
    title.textContent = 'Filters';
    const headerActions = document.createElement('div');
    headerActions.className = 'combo-filter-panel__header-actions';
    const resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.textContent = 'Reset Filters';
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.textContent = 'Close';
    headerActions.appendChild(resetButton);
    headerActions.appendChild(closeButton);
    header.appendChild(title);
    header.appendChild(headerActions);
    panel.appendChild(header);

    const sectionVisibilitySection = createCollapsibleFilterSection('Visible Sections');
    sectionVisibilitySection.body.classList.add('combo-filter-sections');

    const visibilitySection = createCollapsibleFilterSection('Visible Columns');
    visibilitySection.body.classList.add('combo-filter-visibility');

    const conditionsSection = createCollapsibleFilterSection('Column Filters');

    const optionsSection = createCollapsibleFilterSection('Options');
    optionsSection.body.classList.add('combo-filter-options');
    const hideEmptyLabel = document.createElement('label');
    const hideEmptyCheckbox = document.createElement('input');
    hideEmptyCheckbox.type = 'checkbox';
    hideEmptyLabel.appendChild(hideEmptyCheckbox);
    hideEmptyLabel.appendChild(document.createTextNode('Hide sections without combos'));
    optionsSection.body.appendChild(hideEmptyLabel);

    const presetsSection = document.createElement('section');
    presetsSection.className = 'combo-filter-panel__section combo-filter-presets';
    const presetsHeading = document.createElement('h3');
    presetsHeading.textContent = 'Presets';
    const presetSelect = document.createElement('select');
    const presetsActions = document.createElement('div');
    presetsActions.className = 'combo-filter-presets__actions';
    const savePresetButton = document.createElement('button');
    savePresetButton.type = 'button';
    savePresetButton.textContent = 'Save as Preset';
    const deletePresetButton = document.createElement('button');
    deletePresetButton.type = 'button';
    deletePresetButton.textContent = 'Delete Preset';
    deletePresetButton.disabled = true;
    presetsActions.appendChild(savePresetButton);
    presetsActions.appendChild(deletePresetButton);
    presetsSection.appendChild(presetsHeading);
    presetsSection.appendChild(presetSelect);
    presetsSection.appendChild(presetsActions);

    panel.appendChild(sectionVisibilitySection.section);
    panel.appendChild(visibilitySection.section);
    panel.appendChild(conditionsSection.section);
    panel.appendChild(optionsSection.section);
    panel.appendChild(presetsSection);

    button.addEventListener('click', () => toggleFilterPanel());
    closeButton.addEventListener('click', () => toggleFilterPanel(false));
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        toggleFilterPanel(false);
      }
    });

    hideEmptyCheckbox.addEventListener('change', () => {
      filterState.hideEmptySections = hideEmptyCheckbox.checked;
      persistFilterState();
      applyFilters();
      updateFilterButtonState();
    });

    resetButton.addEventListener('click', (event) => {
      event.preventDefault();
      resetFilters();
    });

    presetSelect.addEventListener('change', (event) => {
      const value = event.target.value || '';
      filterInterface.selectedPresetValue = value;
      if (deletePresetButton) {
        deletePresetButton.disabled = !(value && value.startsWith('custom:'));
      }
      applyPresetFromValue(value);
    });

    savePresetButton.addEventListener('click', (event) => {
      event.preventDefault();
      saveCustomPresetFromState();
    });

    deletePresetButton.addEventListener('click', (event) => {
      event.preventDefault();
      const value = filterInterface.selectedPresetValue || '';
      if (value.startsWith('custom:')) {
        deleteCustomPresetByKey(value.slice('custom:'.length));
        filterInterface.selectedPresetValue = '';
        deletePresetButton.disabled = true;
      }
    });

    filterInterface = {
      button,
      overlay,
      panel,
      sectionVisibilityContainer: sectionVisibilitySection.body,
      visibilityContainer: visibilitySection.body,
      conditionsContainer: conditionsSection.body,
      hideEmptyCheckbox,
      presetSelect,
      savePresetButton,
      deletePresetButton,
      selectedPresetValue: '',
      closeButton,
    };
  }

  const ensureStyles = () => {
    if (document.getElementById('combo-section-styles')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'combo-section-styles';
      style.textContent = `
.citizen-section-heading[role="button"],
.citizen-subsection-heading[role="button"],
.combo-section__header {
  cursor: pointer;
}

.citizen-section-heading {
  margin-top: 0rem !important;
  margin-bottom: 1rem !important;
  padding-left: 0.25rem;
}

.citizen-section-heading:first-of-type {
  margin-top: 0 !important;
}

.citizen-section-heading--collapsed {
  margin-bottom: 1rem !important;
}

.citizen-section-heading .citizen-section-indicator {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.25em;
  margin-right: 0.5em;
  font-size: 1.1em;
  line-height: 1;
}

.citizen-subsection-heading {
  margin-top: 1.5rem !important;
  margin-bottom: 0.5rem !important;
  padding-left: 0.25rem;
  font-size: 1.5rem;
}

.citizen-subsection-heading:first-of-type {
  margin-top: 0 !important;
}

.citizen-subsection-heading .citizen-section-indicator {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.1em;
  margin-right: 0.5em;
  font-size: 1em;
  line-height: 1;
}

.citizen-section-indicator::before,
.combo-section__indicator::before {
  content: '';
  display: inline-block;
  width: 1em;
  height: 1em;
  background-color: currentColor;
  -webkit-mask-repeat: no-repeat;
  -webkit-mask-position: center;
  -webkit-mask-size: contain;
  mask-repeat: no-repeat;
  mask-position: center;
  mask-size: contain;
}

.citizen-section-indicator.mw-ui-icon-wikimedia-collapse::before,
.combo-section__indicator.mw-ui-icon-wikimedia-collapse::before {
  -webkit-mask-image: url('${COLLAPSE_ICON_MASK}');
  mask-image: url('${COLLAPSE_ICON_MASK}');
}

.citizen-section-indicator.mw-ui-icon-wikimedia-expand::before,
.combo-section__indicator.mw-ui-icon-wikimedia-expand::before {
  -webkit-mask-image: url('${EXPAND_ICON_MASK}');
  mask-image: url('${EXPAND_ICON_MASK}');
}

.section-spacing {
  height: 1.75rem;
  width: 100%;
}

.combo-section__spacer {
  height: 0.875rem;
  width: 100%;
}

.citizen-section-heading + .citizen-section {
  box-sizing: border-box;
  padding-left: 3.25rem !important;
  margin-bottom: 0 !important;
}

.citizen-subsection-heading + .citizen-subsection__content {
  box-sizing: border-box;
  padding-left: 1.5rem !important;
  margin-bottom: 0 !important;
}

.combo-section__header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0.875rem 0 0.5rem;
  font-size: 1rem;
  font-weight: 500;
  margin-left: 1.75rem !important;
}

.combo-section__header--collapsed {
  margin-bottom: 0.875rem;
}

.citizen-section-heading + .citizen-section .combo-section__header:first-child {
  margin-top: 0.5rem;
}

.combo-section__indicator {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.95em;
  line-height: 1;
  min-width: 1.25em;
  width: 1.25em;
}

.combo-section__content {
  margin-left: 3rem !important;
  margin-bottom: 1.5rem;
}

.combo-section__content[hidden] {
  display: none !important;
}

.combo-section__content h4 {
  margin-left: 1.5rem;
}

.combo-section {
  position: relative;
}

.combo-section[hidden] {
  display: none !important;
}

[data-column-hidden='true'] {
  display: none !important;
}

.combo-column--fit {
  width: 1%;
  white-space: nowrap;
}

.combo-column--fixed {
  word-break: break-word;
  white-space: normal;
}

  .combo-table-wrapper {
    position: relative;
    width: 100%;
    --combo-table-scrollbar-height: 12px;
  }

  /* Base wrapper for both scroll areas */
.combo-table-scroll {
  width: 100%;
  scrollbar-gutter: stable both-edges;
  position: relative;
}

/* TOP BAR: custom X scrollbar only, no vertical scroll */
.combo-table-scroll--top {
  scrollbar-color: #494d63 #252933;
  overflow-x: auto;
  overflow-y: hidden;
  position: sticky;
  top: var(--combo-table-scrollbar-offset, var(--height-sticky-header, 0px));
  z-index: 30;
  padding: 0;
  margin: 0 0 0rem;
  height: 15px;
}

/* MAIN SCROLL: table lives here – horizontal scroll only */
.combo-table-scroll--main {
  overflow-x: auto;
  /* clip = like hidden, but not a scroll container vertically,
     so there is never a Y scrollbar on this element */
  overflow-y: clip;
  margin-bottom: 0.25rem;
}

.combo-table-scroll__spacer {
  height: 1px;
}

/* Ensure the *table itself* is never a scroll container */
.combo-table-scroll table {
  width: max-content;
  min-width: 100%;
  table-layout: auto;

  /* Kill any Citizen/Dustloop overrides on tables */
  display: table !important;
  max-height: none !important;
  overflow-y: visible !important;
}

/* Extra safety for wikitable styling specifically */
.combo-table-scroll table.wikitable {
  display: table !important;
  max-height: none !important;
  overflow-y: visible !important;
}


/* Header background inside the real table (non-sticky) */
.combo-table-scroll table thead th,
.combo-table-scroll table thead td {
  background: var(--color-surface-2, rgba(14, 17, 25, 0.98));
}

/* Do NOT try to use native sticky on thead inside the overflow container */
.combo-table-scroll table thead {
  position: static;
}

/* ===== Floating cloned header ===== */

.combo-table-header-wrapper {
  position: fixed;          /* Positioned via JS */
  z-index: 25;              /* Above table content */
  display: none;            /* Only visible when over its table */
  pointer-events: none;     /* Wrapper itself doesn’t eat events */
  overflow: hidden;         /* Clip header to the table/card width */
  background: var(--color-surface-2, rgba(14, 17, 25, 0.98)); /* Hide table behind */
}

.combo-table-header-wrapper--active {
  display: block;
}

.combo-table-header-table {
  /* Match main table layout as closely as possible */
  width: max-content;
  min-width: 100%;
  table-layout: auto;
  border-collapse: collapse;   /* Same as wikitable */
  pointer-events: auto;        /* Clicking cells (sort arrows) still works */
  margin: 0;
}

/* Same background as normal header */
.combo-table-header-table thead th,
.combo-table-header-table thead td {
  background: var(--color-surface-2, rgba(14, 17, 25, 0.98));
}


.combo-table-scroll::-webkit-scrollbar {
  height: 0.75rem;
}

.combo-table-scroll::-webkit-scrollbar:vertical {
  display: none;
}

.combo-table-scroll::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.35);
  border-radius: 999px;
}

.combo-table-scroll::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.12);
  border-radius: 999px;
}

/* Hide any vertical scrollbar UI on the main table scroller */
.combo-table-scroll--main {
  scrollbar-width: none; /* Firefox: no vertical scrollbar UI */
}

.combo-table-scroll--main::-webkit-scrollbar:vertical {
  width: 0 !important;   /* Chrome/Edge/Safari: no vertical bar */
}

.combo-table__empty-row td {
  text-align: center;
  font-style: italic;
  padding: 1rem;
  color: rgba(255, 255, 255, 0.75);
  background: rgba(255, 255, 255, 0.05);
}

.combo-filter-button {
  position: fixed;
  bottom: 1.5rem;
  right: 1.5rem;
  z-index: 1002;
  padding: 0.5rem 1.25rem;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: rgba(10, 13, 21, 0.85);
  color: inherit;
  font-weight: 600;
  box-shadow: 0 0.75rem 1.5rem rgba(0, 0, 0, 0.45);
}

.combo-filter-button::after {
  content: '';
  display: inline-block;
  width: 0.5rem;
  height: 0.5rem;
  margin-left: 0.5rem;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.35);
  transition: background 150ms ease-in-out;
}

.combo-filter-button--active::after {
  background: #ff6b6b;
}

[data-filter-hidden='true'] {
  display: none !important;
}

.combo-filter-overlay {
  position: fixed;
  inset: 0;
  z-index: 1001;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.combo-filter-overlay[hidden] {
  display: none !important;
}

.combo-filter-panel {
  width: min(38rem, 100%);
  max-height: min(42rem, 95vh);
  background: rgba(14, 17, 25, 0.98);
  color: inherit;
  border-radius: 1rem;
  padding: 1.25rem 1.5rem;
  box-shadow: 0 1.5rem 3rem rgba(0, 0, 0, 0.5);
  overflow-y: auto;
}

.combo-filter-panel__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
}

.combo-filter-panel__header-actions {
  display: flex;
  gap: 0.5rem;
}

.combo-filter-panel__header h2 {
  margin: 0;
  font-size: 1.35rem;
}

.combo-filter-panel button,
.combo-filter-panel select,
.combo-filter-panel input,
.combo-filter-panel textarea {
  font: inherit;
}

.combo-filter-panel select option,
.combo-filter-panel select optgroup {
  background-color: #0f1421;
  color: inherit;
}

.combo-filter-panel select optgroup {
  font-weight: 600;
  color: rgba(255, 255, 255, 0.7);
}

.combo-filter-panel select optgroup option {
  font-weight: 400;
  color: #fff;
}

.combo-filter-panel button {
  border-radius: 999px;
  padding: 0.35rem 0.85rem;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.08);
  color: inherit;
  cursor: pointer;
}

.combo-filter-panel button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.combo-filter-panel__section {
  margin-bottom: 1.25rem;
}

.combo-filter-panel__section:last-child {
  margin-bottom: 0;
}

.combo-filter-panel__section h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}

.combo-filter-panel__section-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  border-radius: 0.75rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.05);
  padding: 0.4rem 0.75rem;
  text-align: left;
}

.combo-filter-panel__section-label {
  font-weight: 600;
}

.combo-filter-panel__section-toggle-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1rem;
  height: 1rem;
}

.combo-filter-panel__section-toggle-icon::before {
  content: '';
  display: inline-block;
  width: 0.55rem;
  height: 0.55rem;
  border-right: 2px solid currentColor;
  border-bottom: 2px solid currentColor;
  transform: rotate(45deg);
  transition: transform 0.2s ease;
}

.combo-filter-panel__section-toggle[aria-expanded='false'] .combo-filter-panel__section-toggle-icon::before {
  transform: rotate(-135deg);
}

  .combo-filter-panel__section-body {
    margin-top: 0.75rem;
  }

  .combo-filter-panel__section--collapsed .combo-filter-panel__section-body {
    display: none;
  }

.combo-filter-visibility {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
}

.combo-filter-visibility label {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.9rem;
}

.combo-filter-sections {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

  .combo-filter-section-option {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.9rem;
    padding-left: calc(0.35rem + 0.85rem * var(--section-depth, 0));
  }

  .combo-filter-section-option__label {
    flex: 1;
  }

  .combo-filter-section-option__note {
    display: none;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.65);
  }

  .combo-filter-section-option--disabled {
    opacity: 0.5;
  }

  .combo-filter-section-option--disabled .combo-filter-section-option__note {
    display: inline-flex;
  }

  .combo-filter-section-option input[disabled] {
    cursor: not-allowed;
  }

.combo-filter-visibility input[type='checkbox'] {
  width: 1rem;
  height: 1rem;
}

.combo-filter-condition {
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 0.75rem;
  padding: 0.5rem 0.75rem;
  margin-bottom: 0.75rem;
}

.combo-filter-condition:last-child {
  margin-bottom: 0;
}

.combo-filter-condition summary {
  cursor: pointer;
  font-weight: 600;
  list-style: none;
}

.combo-filter-condition summary::-webkit-details-marker {
  display: none;
}

.combo-filter-condition__body {
  margin-top: 0.5rem;
  display: grid;
  gap: 0.5rem;
}

.combo-filter-condition__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.combo-filter-condition__row label {
  font-size: 0.85rem;
}

.combo-filter-condition__row select,
.combo-filter-condition__row input,
.combo-filter-condition__row textarea {
  flex: 1;
  min-width: 6rem;
  padding: 0.35rem 0.5rem;
  border-radius: 0.35rem;
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: rgba(255, 255, 255, 0.05);
  color: inherit;
}

.combo-filter-enum-options {
  max-height: 10rem;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding-right: 0.25rem;
}

.combo-filter-enum-options label {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
}

.combo-filter-options {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.combo-filter-options label {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.combo-filter-presets select {
  width: 100%;
  padding: 0.35rem 0.5rem;
  border-radius: 0.35rem;
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: rgba(255, 255, 255, 0.05);
  color: inherit;
}

.combo-filter-presets__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

body.combo-filter-open {
  overflow: hidden;
}

  @media (max-width: 720px) {
    .combo-filter-panel {
      padding: 1rem;
    }

    .combo-filter-button {
      right: 1rem;
      bottom: 1rem;
    }
  }

  @media (min-width: 1100px) {
    .citizen-page-sidebar {
      position: sticky;
      top: calc(var(--height-sticky-header, 0px) + 1rem);
      align-self: flex-start;
      min-height: calc(100vh - var(--height-sticky-header, 0px) - 1rem);
      max-height: calc(100vh - var(--height-sticky-header, 0px) - 1rem);
    }

    .citizen-page-sidebar #citizen-toc .citizen-menu__card {
      min-height: calc(100vh - var(--height-sticky-header, 0px) - 2rem);
      max-height: calc(100vh - var(--height-sticky-header, 0px) - 2rem);
      overflow: auto;
    }
  }

  .combo-section__header:focus-visible,
  .citizen-section-heading[role="button"]:focus-visible {
    outline: 2px solid currentColor;
    outline-offset: 2px;
  }

  #view-toggle {
    display: flex;
    justify-content: center;
  }

  .view-toggle {
    margin: 1rem auto 1.1rem;
    display: inline-flex;
    align-items: stretch;
    width: min(100%, 22rem);
    border: 1px solid var(--color-border, rgba(255, 255, 255, 0.25));
    border-radius: 999px;
    overflow: hidden;
    background: var(--color-surface-2, rgba(14, 17, 25, 0.82));
    box-shadow: 0 0.75rem 1.5rem rgba(0, 0, 0, 0.25);
  }

  .view-toggle__button {
    appearance: none;
    border: 0;
    background: transparent;
    color: inherit;
    padding: 0.6rem 1.1rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    cursor: pointer;
    flex: 1 1 0;
    text-align: center;
    transition: background 150ms ease-in-out, color 150ms ease-in-out;
  }

  .view-toggle__button + .view-toggle__button {
    border-left: 1px solid var(--color-border, rgba(255, 255, 255, 0.15));
  }

  .view-toggle__button:hover:not(.view-toggle__button--active) {
    background: rgba(255, 255, 255, 0.06);
  }

  .view-toggle__button--active {
    background: var(--color-progressive, #ff6b6b);
    color: #fff;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.25);
  }

  #database-view-root {
    margin: 1rem 0 0;
    width: 100%;
  }

  #database-view-root[hidden] {
    display: none !important;
  }

  body.database-view-active .citizen-page-sidebar {
    display: none !important;
  }

  body.database-view-active #page-sections-root {
    display: none !important;
  }

  body.database-view-active #database-view-root {
    display: block;
  }

  body.database-view-active #combo-database-root .wikitable {
    margin-left: 0;
    margin-right: 0;
    /* DO NOT force width: 100% here.
       Let .combo-table-scroll decide the table width (max-content)
       so horizontal overflow lives in the scroll container we control. */
  }

  .combo-section.combo-section--database .combo-section__header {
    cursor: default;
  }

  .combo-section--database .combo-section__indicator {
    display: none;
  }

  .combo-section--database {
    margin: 0;
    padding: 0;
  }

    .combo-section--database .combo-section__content {
      margin-top: 0.5rem;
      margin-left: 0 !important;   /* <– kill the 3rem indent in DB view */
      margin-right: 0 !important;
    }

    body.database-view-active .citizen-body-container {
      /* Drop the normal content + sidebar layout */
      display: block;
      max-width: none !important;
      width: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
    }

    
    body.database-view-active .citizen-page-container {
      padding: 0 !important;
    }


  body.database-view-active .citizen-body {
    max-width: none !important;
    width: 100% !important;
    margin: 0 !important;
    padding-left: 0 !important;
    padding-right: 0 !important;
  }

  body.database-view-active #mw-content-text,
  body.database-view-active .mw-body-content,
  body.database-view-active .mw-content-ltr {
    margin-left: 0 !important;
    margin-right: 0 !important;
    padding-left: 0 !important;
    padding-right: 0 !important;
  }

  body.database-view-active #database-view-root {
    width: 100% !important;
    max-width: none !important;
    margin-left: 0 !important;
    margin-right: 0 !important;
  }

  body.database-view-active #combo-database-root,
  body.database-view-active #combo-database-root .combo-section.combo-section--database,
  body.database-view-active #combo-database-root .combo-section--database .combo-section__content {
    width: 100% !important;
    margin: 0 !important;
    padding-left: 0 !important;
    padding-right: 0 !important;
  }

  body.database-view-active #combo-database-root .combo-table-wrapper,
  body.database-view-active #combo-database-root .combo-table-scroll {
    width: 100% !important;
  }

`;

    if (document.head) {
      document.head.appendChild(style);
    }
  };

  const CITIZEN_TOGGLE_DATA_KEY = 'citizenToggleInitialised';

  const applyIndicatorState = (indicator, collapsed) => {
    if (!indicator) {
      return;
    }
    indicator.textContent = '';
    indicator.classList.add('citizen-ui-icon', 'mw-ui-icon', 'mw-ui-icon-element');
    indicator.classList.toggle('mw-ui-icon-wikimedia-expand', collapsed);
    indicator.classList.toggle('mw-ui-icon-wikimedia-collapse', !collapsed);
  };

  const initialiseCitizenSectionHeading = (heading) => {
    if (!heading || heading.dataset[CITIZEN_TOGGLE_DATA_KEY] === 'true') {
      return;
    }

    const content = heading.nextElementSibling;
    if (
      !(
        content &&
        (content.matches('section.citizen-section') || content.matches('.citizen-subsection__content'))
      )
    ) {
      return;
    }

    heading.dataset[CITIZEN_TOGGLE_DATA_KEY] = 'true';

    let indicator = heading.querySelector('.citizen-section-indicator');
    if (!indicator) {
      indicator = document.createElement('span');
      heading.insertBefore(indicator, heading.firstChild);
    }

    indicator.className = 'citizen-section-indicator';
    indicator.setAttribute('aria-hidden', 'true');

    const indicatorElement = indicator;

    if (!heading.hasAttribute('role')) {
      heading.setAttribute('role', 'button');
    }
    if (!heading.hasAttribute('tabindex')) {
      heading.tabIndex = 0;
    }

    const contentId =
      content.id ||
      heading.getAttribute('aria-controls') ||
      `${heading.id || 'citizen-section'}-${Math.random().toString(36).slice(2)}`;
    if (!content.id) {
      content.id = contentId;
    }
    heading.setAttribute('aria-controls', contentId);

    const originalHiddenValue = content.hasAttribute('hidden')
      ? content.getAttribute('hidden')
      : null;

    const updateIndicator = (collapsed) => {
      applyIndicatorState(indicatorElement, collapsed);
    };

    const setCollapsed = (collapsed) => {
      if (collapsed) {
        if (originalHiddenValue) {
          content.setAttribute('hidden', originalHiddenValue);
        } else {
          content.setAttribute('hidden', '');
        }
        heading.setAttribute('aria-expanded', 'false');
        heading.classList.add('citizen-section-heading--collapsed');
      } else {
        content.removeAttribute('hidden');
        heading.setAttribute('aria-expanded', 'true');
        heading.classList.remove('citizen-section-heading--collapsed');
      }
      updateIndicator(collapsed);
    };

    const toggleCollapsed = () => {
      const collapsed = heading.getAttribute('aria-expanded') === 'false';
      setCollapsed(!collapsed);
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

    const initiallyCollapsed =
      heading.classList.contains('citizen-section-heading--collapsed') ||
      (content.hasAttribute('hidden') && content.getAttribute('hidden') !== 'until-found');

    setCollapsed(initiallyCollapsed);
  };

  const initialiseCitizenSectionHeadings = () => {
    document
      .querySelectorAll('h2.citizen-section-heading, h3.citizen-subsection-heading')
      .forEach((heading) => initialiseCitizenSectionHeading(heading));
  };

    const getSources = () => ({
      source: comboRoot.dataset.source || 'combo-sections.json',
      formattingSource: comboRoot.dataset.formattingRules || 'combo-formatting-rules.json',
      tableDefinitionsSource: comboRoot.dataset.tableDefinitions || 'combo-table-definitions.json',
      presetDefinitionsSource: comboRoot.dataset.presetDefinitions || 'combo-filter-presets.json',
      spreadsheetSource: comboRoot.dataset.spreadsheetSource || 'combo-spreadsheet-source.json',
    });

  const buildCorsProxyUrl = (url) => {
    try {
      const baseOrigin =
        typeof window !== 'undefined' && window.location
          ? new URL(window.location.href).origin
          : 'http://localhost';
      const parsed = new URL(url, baseOrigin);
      if (parsed.origin === baseOrigin || /corsproxy\.io$/.test(parsed.hostname)) {
        return null;
      }

      return `https://corsproxy.io/?${encodeURIComponent(parsed.href)}`;
    } catch (error) {
      console.warn('Unable to build CORS proxy URL', error);
      return null;
    }
  };

  const fetchWithCorsFallback = (url, parseResponse, { optional } = {}) => {
    const attemptFetch = (target) =>
      fetch(target).then((response) => {
        if (!response.ok) {
          if (optional) {
            return null;
          }
          throw new Error(`Failed to fetch ${target}: ${response.status}`);
        }
        return parseResponse(response);
      });

    return attemptFetch(url).catch((error) => {
      const proxyUrl = buildCorsProxyUrl(url);
      if (proxyUrl) {
        console.warn(`Retrying ${url} via CORS proxy`, error);
        return attemptFetch(proxyUrl).catch((proxyError) => {
          if (optional) {
            return null;
          }
          throw proxyError;
        });
      }

      if (optional) {
        return null;
      }

      throw error;
    });
  };

  const fetchJson = (url, { optional } = {}) =>
    fetchWithCorsFallback(
      url,
      (response) => response.json(),
      { optional },
    );

  const fetchText = (url, { optional } = {}) =>
    fetchWithCorsFallback(
      url,
      (response) => response.text(),
      { optional },
    );

  const DESCRIPTION_SOURCE_KEYS = ['descriptions', 'descriptions_html'];

  const collectDescriptionSources = (sections) => {
    const sources = new Set();
    if (!Array.isArray(sections)) {
      return sources;
    }

    sections.forEach((section) => {
      if (!section || typeof section !== 'object') {
        return;
      }

      DESCRIPTION_SOURCE_KEYS.forEach((key) => {
        const entries = Array.isArray(section[key]) ? section[key] : [];
        entries.forEach((entry) => {
          if (!entry || typeof entry !== 'object') {
            return;
          }
          const source = typeof entry.source === 'string' ? entry.source.trim() : '';
          if (source) {
            sources.add(source);
          }
        });
      });
    });

    return sources;
  };

  const parseCsvLine = (line) => {
    const values = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        values.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current);
    return values;
  };

  const parseCsv = (csvText) => {
    if (typeof csvText !== 'string') {
      return { headers: [], rows: [] };
    }

    const normalised = csvText.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '');
    const rows = [];
    let currentRow = [];
    let currentValue = '';
    let inQuotes = false;

    for (let i = 0; i < normalised.length; i += 1) {
      const char = normalised[i];
      if (char === '"') {
        if (inQuotes && normalised[i + 1] === '"') {
          currentValue += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        currentRow.push(currentValue);
        currentValue = '';
      } else if (char === '\n' && !inQuotes) {
        currentRow.push(currentValue);
        rows.push(currentRow);
        currentRow = [];
        currentValue = '';
      } else {
        currentValue += char;
      }
    }

    if (currentValue.length || currentRow.length) {
      currentRow.push(currentValue);
      rows.push(currentRow);
    }

    const trimmedRows = rows
      .map((row) => row.map((value) => value.trimEnd()))
      .filter((row) => row.some((value) => value !== ''));

    if (!trimmedRows.length) {
      return { headers: [], rows: [] };
    }

    const [headerRow, ...dataRows] = trimmedRows;
    const headers = headerRow.map((header) => header.trim());

    return { headers, rows: dataRows };
  };

  const normaliseSpreadsheetCsvUrl = (csvUrl) => {
    if (typeof csvUrl !== 'string') {
      return csvUrl;
    }

    if (!/^https?:\/\//i.test(csvUrl)) {
      return csvUrl;
    }

    try {
      const url = new URL(csvUrl);
      const isGoogleSheet =
        url.hostname === 'docs.google.com' && url.pathname.startsWith('/spreadsheets/d/');
      if (!isGoogleSheet) {
        return csvUrl;
      }

      const pathSegments = url.pathname.split('/').filter(Boolean);
      const idIndex = pathSegments.indexOf('d') + 1;
      const spreadsheetId = pathSegments[idIndex];
      if (!spreadsheetId) {
        return csvUrl;
      }
      const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
      const searchParams = url.searchParams || new URLSearchParams();
      const gid = hashParams.get('gid') || searchParams.get('gid');

      const exportParams = new URLSearchParams();
      exportParams.set('format', searchParams.get('format') || 'csv');
      if (gid) {
        exportParams.set('gid', gid);
      }

      return `${url.origin}/spreadsheets/d/${spreadsheetId}/export?${exportParams.toString()}`;
    } catch (error) {
      console.warn('Unable to normalise spreadsheet URL', error);
      return csvUrl;
    }
  };

  const buildColumnLabel = (column) => {
    if (!column) {
      return '';
    }
    if (typeof column.text === 'string' && column.text.trim()) {
      return column.text.trim();
    }
    if (typeof column.label === 'string' && column.label.trim()) {
      return column.label.trim();
    }
    if (column.header && typeof column.header.text === 'string' && column.header.text.trim()) {
      return column.header.text.trim();
    }
    if (typeof column.html === 'string' && column.html.trim()) {
      return extractTextContent(column.html).trim();
    }
    if (typeof column === 'string') {
      return column.trim();
    }
    return '';
  };

  const normaliseColumnWidthSetting = (value) => {
    if (value == null) {
      return null;
    }

    if (value && typeof value === 'object' && value.mode) {
      const mode = String(value.mode).toLowerCase();
      if (mode === 'fit') {
        return { mode: 'fit' };
      }
      if (mode === 'fixed') {
        return value.value ? { mode: 'fixed', value: String(value.value) } : null;
      }
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }
      const lower = trimmed.toLowerCase();
      if (lower === 'best-fit' || lower === 'best fit' || lower === 'fit' || lower === 'fit-content') {
        return { mode: 'fit' };
      }
      return { mode: 'fixed', value: trimmed };
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return { mode: 'fixed', value: `${value}px` };
    }

    return null;
  };

  const buildColumnWidthLookup = (tableDefinition) => {
    const lookup = new Map();
    if (!tableDefinition || !tableDefinition.columnWidths || typeof tableDefinition.columnWidths !== 'object') {
      return lookup;
    }

    Object.entries(tableDefinition.columnWidths).forEach(([key, value]) => {
      const normalisedKey = String(key || '').trim().toLowerCase();
      const widthSetting = normaliseColumnWidthSetting(value);
      if (normalisedKey && widthSetting) {
        lookup.set(normalisedKey, widthSetting);
      }
    });

    return lookup;
  };

  const buildColumnLookup = (columns) => {
    const lookup = new Map();
    (columns || []).forEach((column) => {
      const label = buildColumnLabel(column).toLowerCase();
      if (label) {
        lookup.set(label, column);
      }
    });
    return lookup;
  };

  const createDefaultColumnDefinition = (header) => ({
    text: header,
    type: 'string',
    filter: { enabled: true },
    description: `Unformatted column sourced from "${header}"`,
  });

  const buildColumnsFromHeaders = (headers, baseColumns, widthLookup = new Map()) => {
    const lookup = buildColumnLookup(baseColumns);
    return headers.map((header) => {
      const normalisedHeader = String(header || '').trim();
      const match = lookup.get(normalisedHeader.toLowerCase());
      const resolved = match ? Object.assign({}, match) : createDefaultColumnDefinition(normalisedHeader);
      const width = widthLookup.get(normalisedHeader.toLowerCase());
      if (width && typeof resolved === 'object') {
        resolved.width = width;
      }
      return resolved;
    });
  };

  const getSectionTableType = (section, fallbackType = 'default') => {
    if (!section || typeof section !== 'object') {
      return fallbackType;
    }
    if (typeof section.table === 'string') {
      return section.table;
    }
    if (section.table && typeof section.table === 'object' && section.table.type) {
      return section.table.type;
    }
    return fallbackType;
  };

    const resolveBaseColumns = (section, tableDefinitions, defaultTableType) => {
      const tableType = getSectionTableType(section, defaultTableType);
      const tableDefinition = resolveDefinitionForType(tableDefinitions || {}, tableType) || {};
      if (section && Array.isArray(section.columns)) {
        return section.columns;
      }
      if (Array.isArray(tableDefinition.columns)) {
        return tableDefinition.columns;
      }
      return [];
    };

  const mapSheetRowToValues = (rowObject, headers) =>
    headers.map((header) => {
      const value = rowObject[header];
      return value != null ? value : '';
    });

  const buildSlug = (value) =>
    String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

  const applySpreadsheetRows = (sections, tableDefinitions, spreadsheetConfig) => {
    if (!spreadsheetConfig || typeof spreadsheetConfig !== 'object') {
      return sections;
    }

    const { sectionColumn = 'Situation', tableType = 'standard' } = spreadsheetConfig;
    const entries = Array.isArray(spreadsheetConfig.entries) ? spreadsheetConfig.entries : [];
    const headers = Array.isArray(spreadsheetConfig.headers) ? spreadsheetConfig.headers : [];
    const records = entries.map((row) => {
      const record = {};
      headers.forEach((header, index) => {
        record[header] = row[index];
      });
      return record;
    });

    if (!records.length || !headers.length) {
      return sections;
    }

    const sectionsWithIndex = new Map();
    (sections || []).forEach((section, index) => {
      sectionsWithIndex.set(resolveSectionLabel(section, index).toLowerCase(), { section, index });
    });

    const tableDefinition = resolveDefinitionForType(tableDefinitions || {}, tableType) || {};
    const baseColumns = resolveBaseColumns(null, tableDefinitions, tableType);
    const widthLookup = buildColumnWidthLookup(tableDefinition);
    const columns = buildColumnsFromHeaders(headers, baseColumns, widthLookup);

    const rowsBySection = new Map();
    records.forEach((record) => {
      const sectionName = String(record[sectionColumn] || 'Unsorted').trim();
      if (!rowsBySection.has(sectionName)) {
        rowsBySection.set(sectionName, []);
      }
      rowsBySection.get(sectionName).push(mapSheetRowToValues(record, headers));
    });

    const outputSections = Array.from(sections || []);

    rowsBySection.forEach((rows, name) => {
      const existing = sectionsWithIndex.get(name.toLowerCase());
      if (existing) {
        const target = outputSections[existing.index];
        const existingRows = Array.isArray(target.rows) ? target.rows : [];
        target.columns = columns;
        target.rows = existingRows.concat(rows);
        if (!target.table) {
          target.table = { type: tableType };
        }
      } else {
        outputSections.push({
          anchor: buildSlug(name) || undefined,
          headline_id: buildSlug(name) || undefined,
          title: { text: name, wrap: 'b' },
          rows: rows,
          columns,
          table: { type: tableType },
        });
      }
    });

    return outputSections;
  };

  const applyDescriptionSources = (sections, htmlMap) => {
    if (!Array.isArray(sections)) {
      return [];
    }

    return sections.map((section) => {
      if (!section || typeof section !== 'object') {
        return section;
      }

      const updated = { ...section };

      DESCRIPTION_SOURCE_KEYS.forEach((key) => {
        if (!Array.isArray(section[key])) {
          return;
        }

        updated[key] = section[key].map((entry) => {
          if (!entry || typeof entry !== 'object') {
            return entry;
          }

          const source = typeof entry.source === 'string' ? entry.source.trim() : '';
          if (!source) {
            return entry;
          }

          const html = htmlMap.get(source);
          if (html == null) {
            return entry;
          }

          const clone = { ...entry };
          delete clone.source;
          if (clone.html == null) {
            clone.html = html;
          }
          return clone;
        });
      });

      return updated;
    });
  };

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

  const formatTextWithLinks = (value, formatText, defaultAutoFormat) => {
    const linkPattern = /\(([^|()]+)\|([^\)]+)\)/g;
    const text = value == null ? '' : String(value);

    if (!text) {
      return '';
    }

    const hasLinkSyntax = linkPattern.test(text);
    linkPattern.lastIndex = 0;

    if (!hasLinkSyntax) {
      return formatText(text, { autoFormat: defaultAutoFormat });
    }

    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = linkPattern.exec(text))) {
      if (match.index > lastIndex) {
        const preceding = text.slice(lastIndex, match.index);
        parts.push(formatText(preceding, { autoFormat: defaultAutoFormat }));
      }

      const label = match[1] != null ? match[1].trim() : '';
      const href = match[2] != null ? match[2].trim() : '';

      if (label && href) {
        const safeLabel = formatText(label, { autoFormat: defaultAutoFormat });
        const safeHref = escapeHtml(href);
        parts.push(`<a href="${safeHref}" target="_blank" rel="nofollow">${safeLabel}</a>`);
      } else {
        const fallback = text.slice(match.index, linkPattern.lastIndex);
        parts.push(formatText(fallback, { autoFormat: defaultAutoFormat }));
      }

      lastIndex = linkPattern.lastIndex;
    }

    if (lastIndex < text.length) {
      parts.push(formatText(text.slice(lastIndex), { autoFormat: defaultAutoFormat }));
    }

    return parts.join('');
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
      return formatTextWithLinks(value, formatText, defaultAutoFormat);
    }

    if (typeof value === 'object') {
      if (typeof value.html === 'string') {
        return value.html;
      }
      const autoFormatOverride = resolveAutoFormatPreference(value);
      const text = value.text != null ? value.text : '';
      const autoFormat = autoFormatOverride !== undefined ? autoFormatOverride : defaultAutoFormat;
      return formatTextWithLinks(text, formatText, autoFormat);
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

  const applyColumnWidthConfig = (cell, widthConfig, { isHeader = false } = {}) => {
    if (!cell || !widthConfig) {
      return;
    }

    if (widthConfig.mode === 'fit') {
      cell.classList.add('combo-column--fit');
      return;
    }

    if (widthConfig.mode === 'fixed' && widthConfig.value) {
      cell.style.width = widthConfig.value;
      cell.style.maxWidth = widthConfig.value;
      cell.style.minWidth = widthConfig.value;
      if (!isHeader) {
        cell.classList.add('combo-column--fixed');
      }
    }
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
          applyTooltip(header, buildTooltip(config.description));
          return;
        }

        header.setAttribute('aria-sort', 'none');
        applyTooltip(header, buildTooltip(config.description, 'Click to sort', { separator: ' | ' }));
      });

      const activeHeader = headers[columnIndex];
      if (activeHeader) {
        const ascending = order === 'asc';
        const activeConfig = columnConfigs[columnIndex] || {};
        activeHeader.classList.add(ascending ? 'headerSortUp' : 'headerSortDown');
        activeHeader.setAttribute('aria-sort', ascending ? 'ascending' : 'descending');
        activeHeader.dataset.sortOrder = order;
        const toggleHint = activeConfig.sortDisabled
          ? ''
          : ascending
          ? 'Sort descending'
          : 'Sort ascending';
        applyTooltip(
          activeHeader,
          buildTooltip(activeConfig.description, toggleHint, { separator: ' | ' }),
        );
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

  const syncHorizontalScrollbars = (table, topScroll, mainScroll) => {
    if (!table || !topScroll || !mainScroll) {
      return () => {};
    }

    const spacer = topScroll.querySelector('.combo-table-scroll__spacer');
    const updateSpacerWidth = () => {
      const scrollWidth =
        mainScroll.scrollWidth || table.scrollWidth || table.getBoundingClientRect().width;
      if (spacer) {
        spacer.style.width = `${scrollWidth}px`;
      }
    };

    let syncing = null;
    const handleScroll = (source, target) => {
      if (syncing === source) {
        syncing = null;
        return;
      }
      syncing = source;
      target.scrollLeft = source.scrollLeft;
    };

    topScroll.addEventListener('scroll', () => handleScroll(topScroll, mainScroll));
    mainScroll.addEventListener('scroll', () => handleScroll(mainScroll, topScroll));

    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(updateSpacerWidth);
      observer.observe(table);
    }

    window.addEventListener('resize', updateSpacerWidth);
    updateSpacerWidth();
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(updateSpacerWidth);
    }

    topScroll.scrollLeft = mainScroll.scrollLeft;

    return updateSpacerWidth;
  };

  const getRootPixelValue = (variableName) => {
    if (typeof getComputedStyle !== 'function' || !document || !document.documentElement) {
      return 0;
    }

    const value = getComputedStyle(document.documentElement).getPropertyValue(variableName);
    const numeric = Number.parseFloat(value);
    return Number.isFinite(numeric) ? numeric : 0;
  };

  const applyScrollbarMeasurements = (wrapper, topScroll, mainScroll, table) => {
    if (!wrapper || !topScroll || !mainScroll) {
      return;
    }

    const update = () => {
      const scrollbarHeight = Math.max(0, mainScroll.offsetHeight - mainScroll.clientHeight);
      const effectiveHeight = scrollbarHeight || 12;
      const value = `${effectiveHeight}px`;
      const headerOffset = getRootPixelValue('--height-sticky-header') + effectiveHeight;
      const headerValue = `${headerOffset}px`;
      wrapper.style.setProperty('--combo-table-scrollbar-height', value);
      topScroll.style.setProperty('--combo-table-scrollbar-height', value);
      mainScroll.style.setProperty('--combo-table-scrollbar-height', value);
      wrapper.style.setProperty('--combo-table-header-offset', headerValue);
      topScroll.style.setProperty('--combo-table-header-offset', headerValue);
      mainScroll.style.setProperty('--combo-table-header-offset', headerValue);
      if (table) {
        table.style.setProperty('--combo-table-scrollbar-height', value);
        table.style.setProperty('--combo-table-header-offset', headerValue);
      }
    };

    update();
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(update);
      observer.observe(mainScroll);
    }
    window.addEventListener('resize', update);
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(update);
    }
  };

  const createTable = (section, formatText, defaultAutoFormat, tableDefinitions, sectionIndex) => {
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

    (columnValues || []).forEach((column, columnIndex) => {
      const th = document.createElement('th');
      th.className = 'headerSort';
      th.setAttribute('tabindex', '0');
      th.setAttribute('role', 'columnheader button');
      let html;
      const columnConfig = {
        autoFormat: undefined,
        headerColor: null,
        valueColor: null,
        header: null,
        sort: null,
        sortDisabled: false,
        width: null,
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

          if (typeof column.description === 'string' && column.description.trim()) {
            columnConfig.description = column.description.trim();
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

          const widthSetting = column && typeof column === 'object' ? column.width || column.columnWidth : null;
          const widthConfig = normaliseColumnWidthSetting(widthSetting);
          if (widthConfig) {
            columnConfig.width = widthConfig;
          }
      } else {
        html = normaliseCell(column, formatText, defaultAutoFormat);
      }

      columnConfig.autoFormat = autoFormatOverride;
    }

    const columnInfo = resolveColumnInfo(column, columnIndex);
    columnConfig.key = columnInfo.key;
    columnConfig.label = columnInfo.label;
    if (columnInfo.filterType) {
      columnConfig.filterType = columnInfo.filterType;
    }
    if (columnInfo.filterEnabled !== undefined) {
      columnConfig.filterEnabled = columnInfo.filterEnabled;
    }
    registerColumnDefinition(columnConfig);

    columnConfigs.push(columnConfig);

    th.innerHTML = html;
    applyColumnWidthConfig(th, columnConfig.width, { isHeader: true });
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
    const sortHint = columnConfig.sortDisabled ? '' : 'Click to sort';
    applyTooltip(th, buildTooltip(columnConfig.description, sortHint, { separator: ' | ' }));
    if (columnConfig.key) {
      th.dataset.columnKey = columnConfig.key;
    }
    headerRow.appendChild(th);
  });

    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    const useHtmlRows = Array.isArray(section.rows_html);
    const rowValues = useHtmlRows ? section.rows_html : section.rows;
    const rowsMetadata = [];

    (rowValues || []).forEach((row) => {
      if (!Array.isArray(row)) {
        return;
      }

      const tr = document.createElement('tr');
      const cellValues = {};
      for (let columnIndex = 0; columnIndex < columnConfigs.length; columnIndex += 1) {
        const columnConfig = columnConfigs[columnIndex] || {};
        const cell = document.createElement('td');
        const rawValue = row[columnIndex];
        let html = '';
        let sortValue = null;
        if (useHtmlRows) {
          html = rawValue != null ? String(rawValue) : '';
          cell.innerHTML = html;
          sortValue = computeSortValue(rawValue, html, columnConfig);
        } else {
          const columnAutoFormat =
            columnConfig.autoFormat !== undefined ? columnConfig.autoFormat : defaultAutoFormat;
          html = normaliseCell(rawValue, formatText, columnAutoFormat);
          cell.innerHTML = html;
          sortValue = computeSortValue(rawValue, html, columnConfig);
        }

        const filterValue = useHtmlRows
          ? normaliseCellValueForFilter(null, html, columnConfig)
          : normaliseCellValueForFilter(rawValue, html, columnConfig);

        if (sortValue != null) {
          cell.setAttribute('data-sort-value', sortValue);
        }
        if (columnConfig.valueColor) {
          applyValueColor(cell, columnConfig.valueColor);
        }
        if (columnConfig.key) {
          cell.dataset.columnKey = columnConfig.key;
          cellValues[columnConfig.key] = filterValue;
        }
        applyColumnWidthConfig(cell, columnConfig.width);
        registerColumnValue(columnConfig, filterValue);
        tr.appendChild(cell);
      }
      rowsMetadata.push({ element: tr, values: cellValues });
      tbody.appendChild(tr);
    });

    const emptyRow = document.createElement('tr');
    emptyRow.className = 'combo-table__empty-row';
    emptyRow.hidden = true;
    const emptyCell = document.createElement('td');
    emptyCell.colSpan = columnConfigs.length || 1;
    emptyCell.textContent = 'No combos match the active filters.';
    emptyRow.appendChild(emptyCell);
    tbody.appendChild(emptyRow);

    table.appendChild(tbody);

    table.appendChild(document.createElement('tfoot'));

    const metadata = {
      element: table,
      rows: rowsMetadata,
      columns: columnConfigs,
      emptyRow,
      sectionIndex,
      sectionKey: null,
    };
    tableMetadataMap.set(table, metadata);
    tableMetadataList.push(metadata);

      if (!(window.jQuery && window.jQuery.fn && typeof window.jQuery.fn.tablesorter === 'function')) {
          enableNativeTableSorting(table, columnConfigs);
      }

      // --- Floating header clone (for both Guide view and Database view) ---
      const originalThead = table.tHead;
      let headerWrapper = null;
      let headerTable = null;

      if (originalThead) {
          headerWrapper = document.createElement('div');
          headerWrapper.className = 'combo-table-header-wrapper';

          headerTable = document.createElement('table');
          headerTable.className = `${table.className} combo-table-header-table`;

          const clonedThead = originalThead.cloneNode(true);
          headerTable.appendChild(clonedThead);
          headerWrapper.appendChild(headerTable);

          // NEW: forward events from floating header to real header
          const originalHeaderRow = originalThead.rows && originalThead.rows[0];
          const clonedHeaderRow = clonedThead.rows && clonedThead.rows[0];

          if (originalHeaderRow && clonedHeaderRow) {
              const originalCells = Array.from(originalHeaderRow.cells);
              const clonedCells = Array.from(clonedHeaderRow.cells);
              const count = Math.min(originalCells.length, clonedCells.length);

              for (let i = 0; i < count; i += 1) {
                  const baseCell = originalCells[i];
                  const cloneCell = clonedCells[i];

                  // Make the floating header obviously interactive
                  cloneCell.style.cursor = baseCell.style.cursor || 'pointer';
                  cloneCell.setAttribute('tabindex', baseCell.getAttribute('tabindex') || '0');
                  cloneCell.setAttribute('role', baseCell.getAttribute('role') || 'columnheader');

                  // Click on floating header = click on real header
                  cloneCell.addEventListener('click', (event) => {
                      event.preventDefault();
                      baseCell.click();          // triggers tablesorter *or* enableNativeTableSorting
                      // Optionally resync floating header immediately:
                      if (typeof syncFloatingHeader === 'function') {
                          syncFloatingHeader();
                      }
                  });

                  // Keyboard sorting (Enter / Space) on floating header
                  cloneCell.addEventListener('keydown', (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          baseCell.click();
                          if (typeof syncFloatingHeader === 'function') {
                              syncFloatingHeader();
                          }
                      }
                  });
              }
          }
      }

      const topScroll = document.createElement('div');
      topScroll.className = 'combo-table-scroll combo-table-scroll--top';
      const spacer = document.createElement('div');
      spacer.className = 'combo-table-scroll__spacer';
      topScroll.appendChild(spacer);

      const scrollContainer = document.createElement('div');
      scrollContainer.className = 'combo-table-scroll combo-table-scroll--main';
      scrollContainer.appendChild(table);

      const wrapper = document.createElement('div');
      wrapper.className = 'combo-table-wrapper';
      wrapper.appendChild(topScroll);
      if (headerWrapper) {
          wrapper.appendChild(headerWrapper);
      }
      wrapper.appendChild(scrollContainer);


        const refreshSpacerWidth = syncHorizontalScrollbars(table, topScroll, scrollContainer);
        applyScrollbarMeasurements(wrapper, topScroll, scrollContainer, table);

        // Keep the floating header positioned, visible, and width-synced
      const syncFloatingHeader = () => {
          if (!headerWrapper || !headerTable || !originalThead) {
              return;
          }

          const wrapperRect = wrapper.getBoundingClientRect();
          const barRect = topScroll.getBoundingClientRect();
          const headerRect = originalThead.getBoundingClientRect();
          const tableRect = table.getBoundingClientRect();

          // The line where the header should "freeze":
          // aka top of page
          const headerOffset = 0;

          const headerHeight = headerRect.height || 0;

          // Match wrapper/table horizontal position & width
          headerWrapper.style.width = `${wrapperRect.width}px`;
          headerWrapper.style.left = `${wrapperRect.left}px`;
          headerTable.style.width = `${tableRect.width}px`;

          // NOTE: we do NOT set headerWrapper.style.height here.
          // Its height is purely the header row height, so no extra dark gap.

          // Only show cloned header when:
          // 1) the real header has scrolled up to (or past) the freeze line, and
          // 2) the table still extends below that line (we haven't scrolled past it).
          const withinVerticalRange =
              headerRect.top <= headerOffset &&
              wrapperRect.bottom - headerHeight >= headerOffset;

          if (withinVerticalRange) {
              headerWrapper.classList.add('combo-table-header-wrapper--active');
              headerWrapper.style.top = `${headerOffset}px`;
              // Hide original header so we don't see two at once
              originalThead.style.visibility = 'hidden';
          } else {
              headerWrapper.classList.remove('combo-table-header-wrapper--active');
              headerWrapper.style.top = '';
              originalThead.style.visibility = '';
          }

          // Horizontal sync with the main scroll container
          const scrollLeft = scrollContainer.scrollLeft;
          headerTable.style.transform = `translateX(-${scrollLeft}px)`;

          const baseCells = originalThead.querySelectorAll('th,td');
          const cloneCells = headerTable.querySelectorAll('th,td');
          const count = Math.min(baseCells.length, cloneCells.length);
          for (let i = 0; i < count; i += 1) {
              const baseCell = baseCells[i];
              const cloneCell = cloneCells[i];

              // Width/height sync
              const width = baseCell.getBoundingClientRect().width;
              cloneCell.style.width = `${width}px`;
              if (headerHeight) {
                  cloneCell.style.height = `${headerHeight}px`;
              }

              // NEW: sort-state + accessibility sync
              // Tablesorter-style classes
              cloneCell.classList.toggle(
                  'headerSortUp',
                  baseCell.classList.contains('headerSortUp'),
              );
              cloneCell.classList.toggle(
                  'headerSortDown',
                  baseCell.classList.contains('headerSortDown'),
              );

              // aria-sort
              const ariaSort = baseCell.getAttribute('aria-sort');
              if (ariaSort != null) {
                  cloneCell.setAttribute('aria-sort', ariaSort);
              } else {
                  cloneCell.removeAttribute('aria-sort');
              }

              // data-sortOrder (used by enableNativeTableSorting)
              if (baseCell.dataset && baseCell.dataset.sortOrder != null) {
                  cloneCell.dataset.sortOrder = baseCell.dataset.sortOrder;
              } else if (cloneCell.dataset) {
                  delete cloneCell.dataset.sortOrder;
              }

              // Tooltip/title
              const title = baseCell.getAttribute('title');
              if (title != null) {
                  cloneCell.setAttribute('title', title);
              } else {
                  cloneCell.removeAttribute('title');
              }
          }


          const floatingHeaderRect = headerWrapper.getBoundingClientRect();

          // Scrollbar should sit right below frozen header
          topScroll.style.setProperty(
              "--combo-table-scrollbar-offset",
              `${floatingHeaderRect.height}px`
          );
      };

        if (headerWrapper && headerTable) {
            window.addEventListener('scroll', syncFloatingHeader);
            window.addEventListener('resize', syncFloatingHeader);
            scrollContainer.addEventListener('scroll', () => {
                const scrollLeft = scrollContainer.scrollLeft;
                headerTable.style.transform = `translateX(-${scrollLeft}px)`;
            });
            // first paint
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(syncFloatingHeader);
            } else {
                syncFloatingHeader();
            }
        }

        const refreshScrollState = () => {
            if (typeof refreshSpacerWidth === 'function') {
                refreshSpacerWidth();
            }
            applyScrollbarMeasurements(wrapper, topScroll, scrollContainer, table);
            if (headerWrapper && headerTable) {
                syncFloatingHeader();
            }
        };

        return { table, wrapper, refreshScrollState };
    };


  const createSection = (section, formatText, defaultAutoFormat, tableDefinitions, index) => {
    const sectionContainer = document.createElement('section');
    sectionContainer.className = 'combo-section';
    sectionContainer.dataset.sectionIndex = String(index);
    const sectionLabel = resolveSectionLabel(section, index);

    const header = createHeader(section, formatText, defaultAutoFormat);
    header.classList.add('combo-section__header');

    const indicator = document.createElement('span');
    indicator.className = 'combo-section__indicator';
    indicator.setAttribute('aria-hidden', 'true');
    header.insertBefore(indicator, header.firstChild);

    const baseId =
      (section && (section.headline_id || section.anchor)) || `combo-section-${index}`;
    const sectionKey = String(baseId);
    sectionContainer.dataset.sectionKey = sectionKey;
    registerSectionMetadata(sectionKey, sectionLabel, {
      sectionIndex: index,
      type: 'combo',
      elements: [sectionContainer],
    });
    const contentId = `${String(baseId).replace(/\s+/g, '-')}-content`;
    header.setAttribute('aria-controls', contentId);
    header.setAttribute('aria-expanded', 'true');
    header.setAttribute('role', 'button');
    header.tabIndex = 0;

    const content = document.createElement('div');
    content.className = 'combo-section__content';
    content.id = contentId;

    const descriptions = createDescriptions(section, formatText, defaultAutoFormat);
    if (descriptions && descriptions.childNodes && descriptions.childNodes.length) {
      content.appendChild(descriptions);
    }

    const { table, wrapper, refreshScrollState } =
      createTable(section, formatText, defaultAutoFormat, tableDefinitions, index) || {};
    if (table && wrapper) {
      content.appendChild(wrapper);
      const metadata = tableMetadataMap.get(table);
      if (metadata) {
        metadata.sectionKey = sectionKey;
      }
      if (typeof refreshScrollState === 'function') {
        refreshScrollState();
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(refreshScrollState);
        }
      }
    }

      const setCollapsed = (collapsed) => {
          if (collapsed) {
              content.setAttribute('hidden', '');
              header.setAttribute('aria-expanded', 'false');
              header.classList.add('combo-section__header--collapsed');
          } else {
              content.removeAttribute('hidden');
              header.setAttribute('aria-expanded', 'true');
              header.classList.remove('combo-section__header--collapsed');
          }

          applyIndicatorState(indicator, collapsed);

          // 🔧 NEW: whenever the section opens or closes, resync scroll + sticky header
          if (typeof refreshScrollState === 'function') {
              refreshScrollState();
              if (typeof requestAnimationFrame === 'function') {
                  requestAnimationFrame(refreshScrollState);
              }
          }
      };

    const toggleCollapsed = () => {
      const collapsed = header.getAttribute('aria-expanded') === 'false';
      setCollapsed(!collapsed);
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

    const shouldStartCollapsed = !(
      section && (section.startCollapsed === false || section.start_collapsed === false)
    );
    setCollapsed(shouldStartCollapsed);

    sectionContainer.appendChild(header);
    sectionContainer.appendChild(content);

    const spacer = document.createElement('div');
    spacer.className = 'combo-section__spacer';
    spacer.setAttribute('aria-hidden', 'true');
    spacer.style.height = '0.875rem';
    sectionContainer.appendChild(spacer);
    return sectionContainer;
  };

  const createDatabaseSectionConfig = (sections) => {
    const combinedRows = [];
    let columns = null;
    let columnsHtml = null;

    sections.forEach((section) => {
      (section.rows || []).forEach((row) => {
        if (!Array.isArray(row)) {
          return;
        }
        combinedRows.push([...row]);
      });

      if (!columns && Array.isArray(section.columns)) {
        columns = section.columns;
      }

      if (!columnsHtml && Array.isArray(section.columns_html)) {
        columnsHtml = section.columns_html;
      }
    });

    return {
      anchor: 'Combo_Database',
      headline_id: 'Combo_Database',
      descriptions: [],
      rows: combinedRows,
      columns: columns || undefined,
      columns_html: columnsHtml || undefined,
      table: { type: 'database' },
    };
  };

  const createDatabaseSectionElement = (
    section,
    formatText,
    defaultAutoFormat,
    tableDefinitions,
    sectionIndex = 0,
  ) => {
    const sectionContainer = document.createElement('div');
    sectionContainer.className = 'combo-section combo-section--database';
    sectionContainer.dataset.sectionIndex = String(sectionIndex);
    const sectionLabel = resolveSectionLabel(section, sectionIndex);

    const baseId = (section && (section.headline_id || section.anchor)) || 'combo-database';
    const sectionKey = String(baseId);
    sectionContainer.dataset.sectionKey = sectionKey;
    registerSectionMetadata(sectionKey, sectionLabel, {
      sectionIndex,
      type: 'combo',
      elements: [sectionContainer],
      hasStandaloneContent: true,
    });

    const { table, wrapper, refreshScrollState } =
      createTable(section, formatText, defaultAutoFormat, tableDefinitions, sectionIndex) || {};
    if (table && wrapper) {
      const metadata = tableMetadataMap.get(table);
      if (metadata) {
        metadata.sectionKey = sectionKey;
      }
      sectionContainer.appendChild(wrapper);
      if (typeof refreshScrollState === 'function') {
        refreshScrollState();
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(refreshScrollState);
        }
      }
    }

    return sectionContainer;
  };

  const initialiseTableSorter = () => {
    try {
      if (window.jQuery && window.jQuery.fn && typeof window.jQuery.fn.tablesorter === 'function' && comboRoot) {
        const tables = window.jQuery(comboRoot).find('table.wikitable.sortable');
        tables.trigger('destroy');
        tables.tablesorter();
      }
    } catch (error) {
      console.warn('Unable to initialise tablesorter', error);
    }
  };

  const finaliseRender = () => {
    finaliseColumnRegistry();
    pruneFilterState();
    ensureFilterInterface();
    renderFilterControls();
    applyColumnVisibility();
    applyFilters();
    updateFilterButtonState();
    initialiseTableSorter();
  };

  const renderGuideSections = () => {
    if (!guideRoot || !cachedSections.length || !cachedFormatText) {
      return;
    }

    comboRoot = guideRoot;
    resetColumnMetadata();
    guideRoot.innerHTML = '';
    const fragment = document.createDocumentFragment();
    cachedSections.forEach((section, index) => {
      const defaultAutoFormat = !(
        section && (section.auto_format === false || section.auto_format === 'none')
      );
      fragment.appendChild(
        createSection(section, cachedFormatText, defaultAutoFormat, cachedTableDefinitions, index),
      );
    });
    guideRoot.appendChild(fragment);
    registerPageSectionsFromDom();
    finaliseRender();
  };

  const renderDatabaseView = () => {
    if (!databaseRoot || !cachedSections.length || !cachedFormatText) {
      return;
    }

    comboRoot = databaseRoot;
    resetColumnMetadata();
    databaseRoot.innerHTML = '';
    const databaseSection = createDatabaseSectionConfig(cachedSections);
    const sectionElement = createDatabaseSectionElement(
      databaseSection,
      cachedFormatText,
      true,
      cachedTableDefinitions,
    );
    databaseRoot.appendChild(sectionElement);
    finaliseRender();
  };

  const renderCurrentView = () => {
    if (currentViewMode === VIEW_MODES.DATABASE) {
      renderDatabaseView();
    } else {
      renderGuideSections();
    }
  };

  const updateViewToggleState = () => {
    const toggle = document.getElementById('view-toggle');
    const pageSections = document.getElementById('page-sections-root');
    const databaseContainer = document.getElementById('database-view-root');
    const hasDatabaseTarget = Boolean(databaseRoot);

    if (!hasDatabaseTarget && currentViewMode === VIEW_MODES.DATABASE) {
      currentViewMode = VIEW_MODES.GUIDE;
    }

    if (toggle) {
      toggle.querySelectorAll('[data-view-mode]').forEach((button) => {
        const mode = button.dataset.viewMode === VIEW_MODES.DATABASE ? VIEW_MODES.DATABASE : VIEW_MODES.GUIDE;
        const isActive = mode === currentViewMode;
        button.classList.toggle('view-toggle__button--active', isActive);
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        if (mode === VIEW_MODES.DATABASE && !hasDatabaseTarget) {
          button.setAttribute('disabled', 'true');
        } else {
          button.removeAttribute('disabled');
        }
      });
    }

    if (pageSections) {
      if (currentViewMode === VIEW_MODES.DATABASE) {
        pageSections.setAttribute('hidden', '');
      } else {
        pageSections.removeAttribute('hidden');
      }
    }

    if (databaseContainer) {
      if (currentViewMode === VIEW_MODES.DATABASE) {
        databaseContainer.removeAttribute('hidden');
      } else {
        databaseContainer.setAttribute('hidden', '');
      }
    }

    if (typeof document !== 'undefined' && document.body) {
      document.body.classList.toggle('database-view-active', currentViewMode === VIEW_MODES.DATABASE);
    }
  };

  const setViewMode = (mode, { skipRender } = {}) => {
    const resolvedMode = mode === VIEW_MODES.DATABASE && databaseRoot ? VIEW_MODES.DATABASE : VIEW_MODES.GUIDE;
    currentViewMode = resolvedMode;
    updateViewToggleState();
    if (!skipRender && cachedSections.length && cachedFormatText) {
      renderCurrentView();
    }
  };

  const initialiseViewToggle = () => {
    const toggle = document.getElementById('view-toggle');
    if (!toggle) {
      return;
    }

    toggle.querySelectorAll('[data-view-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        const mode = button.dataset.viewMode === VIEW_MODES.DATABASE ? VIEW_MODES.DATABASE : VIEW_MODES.GUIDE;
        setViewMode(mode);
      });
    });

    updateViewToggleState();
  };

  const displayLoadError = (error) => {
    const detail = error && (error.message || error);
    const message = detail ? `Unable to load combo tables. (${detail})` : 'Unable to load combo tables.';
    console.error('Failed to initialise combo tables', error);
    if (comboRoot) {
      comboRoot.textContent = message;
    }
    if (databaseRoot) {
      databaseRoot.textContent = message;
    }
  };

  const initialise = (rootElement) => {
    if (!rootElement || hasInitialised) {
      return;
    }

    guideRoot = rootElement;
    databaseRoot = document.getElementById(DATABASE_ROOT_ID);
    comboRoot = guideRoot;
    hasInitialised = true;

    ensureStyles();
    initialiseViewToggle();

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initialiseCitizenSectionHeadings, { once: true });
    } else {
      initialiseCitizenSectionHeadings();
    }

    const {
      source,
      formattingSource,
      tableDefinitionsSource,
      presetDefinitionsSource,
      spreadsheetSource,
    } = getSources();

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
      fetchJson(presetDefinitionsSource, { optional: true }).catch((error) => {
        console.warn('Unable to load preset definitions', error);
        return null;
      }),
      fetchJson(spreadsheetSource, { optional: true }).catch((error) => {
        console.warn('Unable to load spreadsheet configuration', error);
        return null;
      }),
    ])
      .then(async ([sections, formattingConfig, tableDefinitions, presetDefinitions, spreadsheetConfig]) => {
        if (!Array.isArray(sections)) {
          throw new Error('Invalid combo sections configuration.');
        }

        const descriptionSources = collectDescriptionSources(sections);
        const htmlMap = new Map();

        await Promise.all(
          Array.from(descriptionSources).map((source) =>
            fetchText(source)
              .then((html) => {
                htmlMap.set(source, html);
              })
              .catch((error) => {
                console.warn(`Unable to load description content from ${source}`, error);
              }),
          ),
        );

        let resolvedSpreadsheetConfig = spreadsheetConfig;
        if (
          spreadsheetConfig &&
          typeof spreadsheetConfig === 'object' &&
          spreadsheetConfig.csvUrl &&
          !Array.isArray(spreadsheetConfig.entries)
        ) {
          const csvUrl = normaliseSpreadsheetCsvUrl(spreadsheetConfig.csvUrl);
          const { headers, rows } = await fetchText(csvUrl)
            .then((csv) => parseCsv(csv))
            .catch((error) => {
              console.warn('Unable to load spreadsheet rows', error);
              return { headers: [], rows: [] };
            });
          resolvedSpreadsheetConfig = Object.assign({}, spreadsheetConfig, { headers, entries: rows, csvUrl });
        }

        const resolvedSections = applySpreadsheetRows(
          applyDescriptionSources(sections, htmlMap),
          tableDefinitions,
          resolvedSpreadsheetConfig,
        );
        const formatText = createFormatter(formattingConfig || { rules: [] });
        const resolvedDefinitions = tableDefinitions || {};
        builtInPresets = normalisePresetDefinitions(presetDefinitions);
        const defaultPreset = builtInPresets.find((preset) => preset.defaultReset);
        defaultPresetValue = defaultPreset ? `built-in:${defaultPreset.key}` : '';
        if (defaultPreset) {
          resetBaselineState = serialiseFilterState(defaultPreset.state || createDefaultFilterState());
          if (!hasStoredFilterState) {
            filterState = cloneFilterState(defaultPreset.state);
            persistFilterState();
          }
        }

        cachedSections = resolvedSections;
        cachedFormatText = formatText;
        cachedTableDefinitions = resolvedDefinitions;
        setViewMode(currentViewMode);
      })
      .catch((error) => {
        displayLoadError(error);
      });
  };

  const existingRoot = document.getElementById(COMBO_SECTIONS_ROOT_ID);
  if (existingRoot) {
    initialise(existingRoot);
  }

  document.addEventListener('combo-sections-root-ready', (event) => {
    if (hasInitialised) {
      return;
    }

    const target =
      (event && event.detail && event.detail.root) ||
      document.getElementById(COMBO_SECTIONS_ROOT_ID);
    if (target) {
      initialise(target);
    }
  });
})();
