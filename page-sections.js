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

  const createSection = async (config) => {
    const section = document.createElement('section');
    section.className = config.sectionClass || 'citizen-section';
    if (config.sectionId) {
      section.id = config.sectionId;
    }
    if (config.sectionAttributes) {
      applyAttributes(section, config.sectionAttributes);
    }

    const contentConfig = config.content || {};
    const mode = contentConfig.mode || 'html-fragment';
    let combosRoot = null;

    if (mode === 'combo-list') {
      const { fragment, combosRoot: createdRoot } = createComboListContent(config, contentConfig);
      combosRoot = createdRoot;
      section.appendChild(fragment);
    } else if (mode === 'html') {
      if (typeof contentConfig.html === 'string') {
        const template = document.createElement('template');
        template.innerHTML = contentConfig.html;
        section.appendChild(template.content);
      }
    } else {
      const fragment = await createHtmlFragment(contentConfig);
      section.appendChild(fragment);
    }

    return { section, combosRoot };
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
        const spacingHeight = sectionConfig.spacingHeight || '1.75rem';

        if (spacingEnabled) {
          fragment.appendChild(createSpacing(spacingHeight));
        }

        const heading = createHeading(sectionConfig);
        fragment.appendChild(heading);

        try {
          const { section, combosRoot } = await createSection(sectionConfig);
          fragment.appendChild(section);
          if (combosRoot) {
            comboRoots.push(combosRoot);
          }
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
