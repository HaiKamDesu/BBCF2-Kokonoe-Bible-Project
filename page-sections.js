(function () {
  const root = document.getElementById('page-sections-root');
  if (!root) {
    return;
  }

  const source = root.dataset.source || 'page-sections.json';

  const fetchJson = (url) =>
    fetch(url).then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.status}`);
      }
      return response.json();
    });

  const fetchText = (url) =>
    fetch(url).then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.status}`);
      }
      return response.text();
    });

  const escapeHtml = (value) => {
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
  };

  const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const buildWrappedHtml = (text, rule) => {
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
  };

  const createTokenMatchers = (rule) => {
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
  };

  const createFormatter = (config) => {
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
  };

  let formattingPromise = null;
  const ensureFormatter = () => {
    if (formattingPromise) {
      return formattingPromise;
    }

    formattingPromise = fetchJson('combo-formatting-rules.json')
      .then((config) => createFormatter(config || { rules: [] }))
      .catch((error) => {
        console.warn('Unable to load formatting rules', error);
        return createFormatter({ rules: [] });
      });

    return formattingPromise;
  };

  const applyFormatting = async (element, { autoFormat } = {}) => {
    if (!element) {
      return;
    }

    const formatter = await ensureFormatter();
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node || !node.nodeValue || !node.nodeValue.trim()) {
          return NodeFilter.FILTER_REJECT;
        }

        if (!node.parentNode) {
          return NodeFilter.FILTER_REJECT;
        }

        const parentTag = node.parentNode.nodeName && node.parentNode.nodeName.toLowerCase();
        if (parentTag === 'script' || parentTag === 'style' || parentTag === 'noscript') {
          return NodeFilter.FILTER_REJECT;
        }

        if (node.parentNode.closest('[data-disable-formatting]')) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const nodes = [];
    let current = walker.nextNode();
    while (current) {
      nodes.push(current);
      current = walker.nextNode();
    }

    nodes.forEach((textNode) => {
      const original = textNode.nodeValue;
      const formatted = formatter(original, { autoFormat });
      if (formatted === escapeHtml(original)) {
        return;
      }

      const template = document.createElement('template');
      template.innerHTML = formatted;
      textNode.replaceWith(template.content);
    });
  };

  const applyAttributes = (element, attributes) => {
    if (!element || !attributes || typeof attributes !== 'object') {
      return;
    }

    Object.entries(attributes).forEach(([attribute, value]) => {
      if (value === false || value == null) {
        element.removeAttribute(attribute);
      } else if (value === true) {
        element.setAttribute(attribute, '');
      } else {
        element.setAttribute(attribute, String(value));
      }
    });
  };

  const applyDataset = (element, dataset) => {
    if (!element || !dataset || typeof dataset !== 'object') {
      return;
    }

    Object.entries(dataset).forEach(([key, value]) => {
      if (value == null) {
        return;
      }
      element.dataset[key] = String(value);
    });
  };

  const ensureSectionStyles = () => {
    if (document.getElementById('page-section-styles')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'page-section-styles';
    style.textContent = `
.citizen-subsection {
  box-sizing: border-box;
  margin-left: 1.25rem;
  margin-bottom: 1.75rem;
}

.citizen-subsection-heading {
  margin-top: 1.5rem !important;
  margin-bottom: 0.5rem !important;
  padding-left: 0.25rem;
  font-size: 1.5rem;
}

.citizen-subsection-heading:first-child {
  margin-top: 0 !important;
}

`;

    document.head.appendChild(style);
  };

  ensureSectionStyles();

  const createSpacing = (height) => {
    const spacing = document.createElement('div');
    spacing.className = 'section-spacing';
    spacing.setAttribute('aria-hidden', 'true');
    if (height) {
      spacing.style.height = height;
    }
    return spacing;
  };

  const createHeading = (config) => {
    const heading = document.createElement('h2');
    heading.className = 'citizen-section-heading';

    if (config.headingClass) {
      heading.classList.add(...String(config.headingClass).split(/\s+/).filter(Boolean));
    }
    if (Array.isArray(config.headingClasses)) {
      config.headingClasses
        .filter((className) => typeof className === 'string' && className.trim())
        .forEach((className) => heading.classList.add(className));
    }

    if (config.headingAttributes) {
      applyAttributes(heading, config.headingAttributes);
    }

    const indicator = document.createElement('span');
    indicator.className = 'citizen-section-indicator citizen-ui-icon mw-ui-icon mw-ui-icon-element mw-ui-icon-wikimedia-collapse';
    indicator.setAttribute('aria-hidden', 'true');
    heading.appendChild(indicator);

    const headline = document.createElement('span');
    headline.className = 'mw-headline';
    if (config.headlineId) {
      headline.id = config.headlineId;
    }

    if (config.titleHtml) {
      headline.innerHTML = config.titleHtml;
    } else {
      headline.textContent = config.title || '';
    }

    heading.appendChild(headline);

    return heading;
  };

  const createSubheading = (config) => {
    const heading = document.createElement('h3');
    heading.className = 'citizen-subsection-heading';

    if (config.headingClass) {
      heading.classList.add(...String(config.headingClass).split(/\s+/).filter(Boolean));
    }
    if (Array.isArray(config.headingClasses)) {
      config.headingClasses
        .filter((className) => typeof className === 'string' && className.trim())
        .forEach((className) => heading.classList.add(className));
    }

    if (config.headingAttributes) {
      applyAttributes(heading, config.headingAttributes);
    }

    const indicator = document.createElement('span');
    indicator.className =
      'citizen-section-indicator citizen-ui-icon mw-ui-icon mw-ui-icon-element mw-ui-icon-wikimedia-collapse';
    indicator.setAttribute('aria-hidden', 'true');
    heading.appendChild(indicator);

    const headline = document.createElement('span');
    headline.className = 'mw-headline';
    if (config.headlineId) {
      headline.id = config.headlineId;
    }

    if (config.titleHtml) {
      headline.innerHTML = config.titleHtml;
    } else {
      headline.textContent = config.title || '';
    }

    heading.appendChild(headline);

    return heading;
  };

  const createHtmlFragment = async (contentConfig) => {
    if (!contentConfig) {
      return document.createDocumentFragment();
    }

    if (typeof contentConfig.html === 'string') {
      const template = document.createElement('template');
      template.innerHTML = contentConfig.html;
      return template.content;
    }

    if (contentConfig.source) {
      const html = await fetchText(contentConfig.source);
      const template = document.createElement('template');
      template.innerHTML = html;
      return template.content;
    }

    return document.createDocumentFragment();
  };

  const createComboListContent = (section, contentConfig) => {
    const fragment = document.createDocumentFragment();

    const rootId = contentConfig.rootId || 'combo-sections-root';
    const combosRoot = document.createElement('div');
    combosRoot.id = rootId;
    combosRoot.setAttribute('data-disable-formatting', 'true');

    const dataset = Object.assign({}, contentConfig.dataAttributes || {});
    if (contentConfig.source) {
      dataset.source = contentConfig.source;
    }
    if (contentConfig.formattingRules) {
      dataset.formattingRules = contentConfig.formattingRules;
    }
    if (contentConfig.tableDefinitions) {
      dataset.tableDefinitions = contentConfig.tableDefinitions;
    }

    applyDataset(combosRoot, dataset);
    fragment.appendChild(combosRoot);

    const noscript = document.createElement('noscript');
    noscript.textContent = contentConfig.noscriptMessage || 'Combo tables require JavaScript to display.';
    fragment.appendChild(noscript);

    return { fragment, combosRoot };
  };

  const renderSectionContent = async (container, config, options = {}) => {
    const contentConfig = (config && config.content) || {};
    const mode = contentConfig.mode || 'html-fragment';
    const comboRoots = [];
    const shouldFormat = options.applyFormatting !== false && contentConfig.applyFormatting !== false;

    if (mode === 'combo-list') {
      const { fragment, combosRoot } = createComboListContent(config, contentConfig);
      comboRoots.push(combosRoot);
      container.appendChild(fragment);
      return comboRoots;
    }

    if (mode === 'html') {
      if (typeof contentConfig.html === 'string') {
        const template = document.createElement('template');
        template.innerHTML = contentConfig.html;
        container.appendChild(template.content);
      }
    } else if (mode === 'group') {
      const groupContainer = document.createElement(contentConfig.groupTag || 'div');
      groupContainer.className = contentConfig.groupClass || 'citizen-section__group';
      container.appendChild(groupContainer);

      const sections = Array.isArray(contentConfig.sections) ? contentConfig.sections : [];
      for (const child of sections) {
        const wrapper = document.createElement(child.sectionTag || 'article');
        wrapper.className = child.sectionClass || 'citizen-subsection';
        if (child.sectionId) {
          wrapper.id = child.sectionId;
        }
        if (child.sectionAttributes) {
          applyAttributes(wrapper, child.sectionAttributes);
        }

        const heading = createSubheading(child);
        if (heading) {
          wrapper.appendChild(heading);
        }

        let contentContainer = wrapper;
        if (heading) {
          contentContainer = document.createElement(child.contentContainerTag || 'div');
          contentContainer.className = child.contentContainerClass || 'citizen-subsection__content';
          if (child.contentContainerId) {
            contentContainer.id = child.contentContainerId;
          }
          if (child.contentContainerAttributes) {
            applyAttributes(contentContainer, child.contentContainerAttributes);
          }
          wrapper.appendChild(contentContainer);
        }

        const childCombos = await renderSectionContent(contentContainer, child, options);
        childCombos.forEach((comboRoot) => comboRoots.push(comboRoot));

        groupContainer.appendChild(wrapper);
      }

      return comboRoots;
    } else {
      const fragment = await createHtmlFragment(contentConfig);
      container.appendChild(fragment);
    }

    if (shouldFormat) {
      await applyFormatting(container, { autoFormat: contentConfig.autoFormat });
    }

    return comboRoots;
  };

  const createSection = async (config) => {
    const section = document.createElement('section');
    section.className = config.sectionClass || 'citizen-section';
    if (config.sectionId) {
      section.id = config.sectionId;
    }
    if (config.sectionAttributes) {
      applyAttributes(section, config.sectionAttributes);
    }

    const comboRoots = await renderSectionContent(section, config);

    return { section, comboRoots };
  };

  const loadSections = async () => {
    try {
      const config = await fetchJson(source);
      if (!Array.isArray(config)) {
        throw new Error('Invalid section configuration');
      }

      root.innerHTML = '';
      const fragment = document.createDocumentFragment();
      const comboRoots = [];

      for (const sectionConfig of config) {
        if (!sectionConfig || typeof sectionConfig !== 'object') {
          continue;
        }

        const spacingEnabled = sectionConfig.spacing !== false;
        const spacingHeight = sectionConfig.spacingHeight || '2rem';

        if (spacingEnabled) {
          fragment.appendChild(createSpacing(spacingHeight));
        }

        const heading = createHeading(sectionConfig);
        fragment.appendChild(heading);
        await applyFormatting(heading, { autoFormat: sectionConfig.autoFormat });

        try {
          const { section, comboRoots: sectionComboRoots } = await createSection(sectionConfig);
          fragment.appendChild(section);
          sectionComboRoots.forEach((comboRoot) => {
            if (comboRoot) {
              comboRoots.push(comboRoot);
            }
          });
        } catch (error) {
          console.error(error);
          const errorSection = document.createElement('section');
          errorSection.className = 'citizen-section';
          errorSection.textContent = 'Unable to load section.';
          fragment.appendChild(errorSection);
        }
      }

      root.appendChild(fragment);
      comboRoots.forEach((comboRoot) => {
        document.dispatchEvent(
          new CustomEvent('combo-sections-root-ready', {
            detail: { root: comboRoot },
          }),
        );
      });
    } catch (error) {
      console.error(error);
      root.textContent = 'Unable to load page sections.';
    }
  };

  loadSections();
})();
