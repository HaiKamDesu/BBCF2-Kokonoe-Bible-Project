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

  const requestFrame = (callback) => {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(callback);
    } else {
      setTimeout(callback, 16);
    }
  };

  const initialiseTableOfContents = (() => {
    let rootObserver = null;
    let pendingBuild = false;
    let contentRoot = null;
    let tocList = null;
    let allEntries = [];
    let entryById = new Map();
    let flatEntries = [];
    let activeEntry = null;
    let pendingScrollUpdate = false;
    let scrollListenerAttached = false;
    const handleScroll = () => {
      scheduleScrollUpdate();
    };

    const setupBackToTopLink = () => {
      const topLink = document.querySelector('#citizen-toc .citizen-toc-top');
      if (!topLink || topLink.dataset.tocInitialised === 'true') {
        return;
      }

      topLink.dataset.tocInitialised = 'true';
      topLink.href = '#';
      topLink.addEventListener('click', (event) => {
        event.preventDefault();
        try {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (error) {
          window.scrollTo(0, 0);
        }
      });
    };

    const collectHeadings = (rootElement) => {
      if (!rootElement) {
        return [];
      }

      const selector =
        'h2.citizen-section-heading, h3.citizen-subsection-heading, h3.combo-section__header';
      return Array.from(rootElement.querySelectorAll(selector))
        .map((element) => {
          const level = Number.parseInt(element.tagName.replace(/[^0-9]/g, ''), 10) || 0;
          const headline = element.querySelector('.mw-headline');
          const id = headline && headline.id ? headline.id : element.id;
          const text = headline && headline.textContent ? headline.textContent.trim() : element.textContent.trim();
          if (!id || !text) {
            return null;
          }

          return {
            element,
            id,
            text,
            level,
          };
        })
        .filter(Boolean);
    };

    const buildHierarchy = (headings) => {
      const rootItems = [];
      const stack = [];

      headings.forEach((heading) => {
        const item = { ...heading, children: [] };

        while (stack.length && stack[stack.length - 1].level >= heading.level) {
          stack.pop();
        }

        if (stack.length) {
          stack[stack.length - 1].children.push(item);
        } else {
          rootItems.push(item);
        }

        stack.push(item);
      });

      return rootItems;
    };

    const getLevelClass = (depth) => `citizen-toc-level-${Math.max(depth + 1, 1)}`;
    const getLevelActiveClass = (depth) => `${getLevelClass(depth)}--active`;

    const updateToggleVisuals = (entry) => {
      if (!entry || !entry.childList) {
        return;
      }

      entry.listItem.classList.toggle('citizen-toc-list-item--expanded', Boolean(entry.expanded));
      entry.childList.hidden = !entry.expanded;

      if (entry.toggleButton) {
        entry.toggleButton.setAttribute('aria-expanded', entry.expanded ? 'true' : 'false');
      }

      if (entry.toggleIcon) {
        entry.toggleIcon.classList.add('citizen-ui-icon', 'mw-ui-icon', 'mw-ui-icon-element');
        entry.toggleIcon.classList.toggle('mw-ui-icon-wikimedia-collapse', Boolean(entry.expanded));
        entry.toggleIcon.classList.toggle('mw-ui-icon-wikimedia-expand', !entry.expanded);
      }
    };

    const setExpanded = (entry, expanded, { silent = false } = {}) => {
      if (!entry || !entry.childList) {
        return;
      }

      const nextState = Boolean(expanded);
      if (entry.expanded === nextState) {
        updateToggleVisuals(entry);
        return;
      }

      entry.expanded = nextState;
      updateToggleVisuals(entry);

      if (!silent && entry.expanded && entry.parent && entry.parent.childList && !entry.parent.expanded) {
        setExpanded(entry.parent, true, { silent: true });
      }
    };

    const getPathToRoot = (entry) => {
      const path = [];
      let current = entry;
      while (current) {
        path.unshift(current);
        current = current.parent || null;
      }
      return path;
    };

    const enforceSingleBranchState = (entry) => {
      if (!entry) {
        return;
      }

      const path = getPathToRoot(entry);
      const pathSet = new Set(path);

      path.forEach((pathEntry) => {
        if (pathEntry.childList) {
          setExpanded(pathEntry, true, { silent: true });
        }
      });

      allEntries.forEach((candidate) => {
        if (!candidate.childList || pathSet.has(candidate)) {
          return;
        }
        setExpanded(candidate, false, { silent: true });
      });
    };

    const expandPath = (entry) => {
      getPathToRoot(entry).forEach((pathEntry) => {
        if (pathEntry.childList) {
          setExpanded(pathEntry, true, { silent: true });
        }
      });
    };

    const setActiveEntry = (entry, { enforceSingleBranch = true } = {}) => {
      if (entry === activeEntry) {
        if (enforceSingleBranch && entry) {
          enforceSingleBranchState(entry);
        }
        return;
      }

      if (activeEntry) {
        activeEntry.listItem.classList.remove('citizen-toc-list-item--active');
        activeEntry.listItem.classList.remove(getLevelActiveClass(activeEntry.depth));
        if (activeEntry.link) {
          activeEntry.link.removeAttribute('aria-current');
        }
      }

      activeEntry = entry || null;

      if (activeEntry) {
        activeEntry.listItem.classList.add('citizen-toc-list-item--active');
        activeEntry.listItem.classList.add(getLevelActiveClass(activeEntry.depth));
        if (activeEntry.link) {
          activeEntry.link.setAttribute('aria-current', 'location');
        }

        if (enforceSingleBranch) {
          enforceSingleBranchState(activeEntry);
        } else {
          expandPath(activeEntry);
        }
      }
    };

    const updateActiveFromScroll = () => {
      if (!flatEntries.length) {
        return;
      }

      const scrollTop =
        (typeof window !== 'undefined' && (window.pageYOffset || document.documentElement.scrollTop)) || 0;
      const offset = 160;
      const targetPosition = scrollTop + offset;

      let candidate = flatEntries[0];
      for (let index = 0; index < flatEntries.length; index += 1) {
        const entry = flatEntries[index];
        const element = entry && entry.item && entry.item.element;
        if (!element) {
          continue;
        }

        const rect = element.getBoundingClientRect();
        const top = rect.top + scrollTop;
        if (top <= targetPosition) {
          candidate = entry;
        } else {
          break;
        }
      }

      setActiveEntry(candidate, { enforceSingleBranch: true });
    };

    const scheduleScrollUpdate = () => {
      if (pendingScrollUpdate) {
        return;
      }

      pendingScrollUpdate = true;
      requestFrame(() => {
        pendingScrollUpdate = false;
        updateActiveFromScroll();
      });
    };

    const ensureScrollListener = () => {
      if (scrollListenerAttached || typeof window === 'undefined') {
        return;
      }

      window.addEventListener('scroll', handleScroll, { passive: true });
      window.addEventListener('resize', handleScroll, { passive: true });
      scrollListenerAttached = true;
    };

    const applyHashSelection = () => {
      if (typeof window === 'undefined' || !window.location || !window.location.hash) {
        return false;
      }

      const rawHash = window.location.hash.replace(/^#/, '');
      if (!rawHash) {
        return false;
      }

      let decodedHash = rawHash;
      try {
        decodedHash = decodeURIComponent(rawHash);
      } catch (error) {
        decodedHash = rawHash;
      }

      const entry = entryById.get(decodedHash) || entryById.get(rawHash);
      if (!entry) {
        return false;
      }

      setActiveEntry(entry, { enforceSingleBranch: true });
      return true;
    };

    const createListEntry = (item, depth, numberingSegments, parentEntry) => {
      if (!item) {
        return null;
      }

      const listItem = document.createElement('li');
      const levelClass = getLevelClass(depth);
      listItem.classList.add('citizen-toc-list-item', levelClass);
      listItem.id = `toc-${item.id}`;

      const link = document.createElement('a');
      link.className = 'citizen-toc-link';
      link.href = `#${item.id}`;
      link.setAttribute('role', 'button');

      const indicator = document.createElement('div');
      indicator.className = 'citizen-toc-indicator';
      link.appendChild(indicator);

      const content = document.createElement('div');
      content.className = 'citizen-toc-content';
      link.appendChild(content);

      const textWrapper = document.createElement('div');
      textWrapper.className = 'citizen-toc-text';
      content.appendChild(textWrapper);

      const numbering = numberingSegments.join('.');
      if (numbering) {
        const numberSpan = document.createElement('span');
        numberSpan.className = 'citizen-toc-numb';
        numberSpan.textContent = numbering;
        textWrapper.appendChild(numberSpan);
      }

      const headingSpan = document.createElement('span');
      headingSpan.className = 'citizen-toc-heading';
      headingSpan.textContent = item.text;
      textWrapper.appendChild(headingSpan);

      const entry = {
        item,
        depth,
        listItem,
        link,
        childList: null,
        toggleButton: null,
        toggleIcon: null,
        parent: parentEntry || null,
        children: [],
        expanded: false,
      };

      if (parentEntry) {
        parentEntry.children.push(entry);
      }

      allEntries.push(entry);
      entryById.set(item.id, entry);

      link.addEventListener('click', (event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }

        event.preventDefault();
        expandPath(entry);
        setActiveEntry(entry, { enforceSingleBranch: true });

        const target = document.getElementById(item.id);
        if (target && typeof target.scrollIntoView === 'function') {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }

        if (window.history && typeof window.history.replaceState === 'function') {
          window.history.replaceState(null, '', `#${item.id}`);
        } else {
          window.location.hash = item.id;
        }
      });

      listItem.appendChild(link);

      if (item.children && item.children.length) {
        const childList = document.createElement('ul');
        childList.className = 'citizen-toc-list';
        childList.id = `${listItem.id}-sublist`;

        const toggleButton = document.createElement('button');
        toggleButton.type = 'button';
        toggleButton.className = 'citizen-toc-toggle';
        toggleButton.setAttribute('aria-controls', childList.id);
        toggleButton.setAttribute('aria-expanded', 'false');

        const toggleIcon = document.createElement('span');
        toggleIcon.className = 'citizen-ui-icon mw-ui-icon mw-ui-icon-element';
        const toggleLabel = document.createElement('span');

        toggleButton.appendChild(toggleIcon);
        toggleButton.appendChild(toggleLabel);

        toggleButton.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          setExpanded(entry, !entry.expanded);
        });

        item.children.forEach((child, index) => {
          const childEntry = createListEntry(child, depth + 1, numberingSegments.concat(index + 1), entry);
          if (childEntry) {
            childList.appendChild(childEntry.listItem);
          }
        });

        entry.childList = childList;
        entry.toggleButton = toggleButton;
        entry.toggleIcon = toggleIcon;

        updateToggleVisuals(entry);

        listItem.appendChild(toggleButton);
        listItem.appendChild(childList);
      }

      return entry;
    };

    const rebuild = () => {
      if (!contentRoot || !tocList) {
        return;
      }

      const headings = collectHeadings(contentRoot);
      const hierarchy = buildHierarchy(headings);

      tocList.innerHTML = '';

      allEntries = [];
      entryById = new Map();
      flatEntries = [];
      activeEntry = null;

      const fragment = document.createDocumentFragment();
      hierarchy.forEach((item, index) => {
        const entry = createListEntry(item, 0, [index + 1], null);
        if (entry) {
          fragment.appendChild(entry.listItem);
        }
      });
      tocList.appendChild(fragment);

      flatEntries = headings
        .map((heading) => entryById.get(heading.id))
        .filter((entry) => entry && entry.item && entry.item.element);

      ensureScrollListener();
      applyHashSelection();
      scheduleScrollUpdate();
    };

    const scheduleRebuild = () => {
      if (pendingBuild) {
        return;
      }

      pendingBuild = true;
      requestFrame(() => {
        pendingBuild = false;
        rebuild();
      });
    };

    return (rootElement) => {
      contentRoot = rootElement;
      tocList = document.getElementById('mw-panel-toc-list');

      if (!contentRoot || !tocList) {
        return;
      }

      setupBackToTopLink();
      scheduleRebuild();

      if (rootObserver) {
        rootObserver.disconnect();
      }

      rootObserver = new MutationObserver(scheduleRebuild);
      rootObserver.observe(contentRoot, { childList: true, subtree: true });
    };
  })();

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

    const collapsedByDefault = !(
      config && (config.startCollapsed === false || config.start_collapsed === false)
    );
    if (collapsedByDefault) {
      heading.classList.add('citizen-section-heading--collapsed');
      heading.setAttribute('aria-expanded', 'false');
    } else {
      heading.setAttribute('aria-expanded', 'true');
    }

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
    if (collapsedByDefault) {
      indicator.classList.remove('mw-ui-icon-wikimedia-collapse');
      indicator.classList.add('mw-ui-icon-wikimedia-expand');
    }
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

    const collapsedByDefault = !(
      config && (config.startCollapsed === false || config.start_collapsed === false)
    );
    if (collapsedByDefault) {
      heading.classList.add('citizen-section-heading--collapsed');
      heading.setAttribute('aria-expanded', 'false');
    } else {
      heading.setAttribute('aria-expanded', 'true');
    }

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
    if (collapsedByDefault) {
      indicator.classList.remove('mw-ui-icon-wikimedia-collapse');
      indicator.classList.add('mw-ui-icon-wikimedia-expand');
    }
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
          const childCollapsedByDefault = !(
            child && (child.startCollapsed === false || child.start_collapsed === false)
          );
          if (childCollapsedByDefault) {
            if (!contentContainer.hasAttribute('hidden')) {
              contentContainer.setAttribute('hidden', '');
            }
          } else {
            contentContainer.removeAttribute('hidden');
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

    const collapsedByDefault = !(
      config && (config.startCollapsed === false || config.start_collapsed === false)
    );
    if (collapsedByDefault) {
      if (!section.hasAttribute('hidden')) {
        section.setAttribute('hidden', '');
      }
    } else {
      section.removeAttribute('hidden');
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
      initialiseTableOfContents(root);
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
