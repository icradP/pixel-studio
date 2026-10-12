import { animateSurface } from './motion.js';

const choices = new WeakMap();
let activeMenu = null,
  nextId = 0;

export function updateRanges(root = document) {
  for (const range of root.querySelectorAll('input[type="range"]')) {
    const min = Number(range.min || 0),
      max = Number(range.max || 100);
    range.style.setProperty(
      '--range-value',
      `${max > min ? ((Number(range.value) - min) / (max - min)) * 100 : 0}%`,
    );
  }
}

export function closeChoiceMenu(focus = false) {
  if (!activeMenu) return false;
  const { menu, button } = activeMenu;
  activeMenu = null;
  menu.remove();
  button.setAttribute('aria-expanded', 'false');
  button.removeAttribute('aria-activedescendant');
  if (focus && button.isConnected) button.focus({ preventScroll: true });
  return true;
}

function enhanceSelect(select) {
  if (select.multiple || select.size > 1 || choices.has(select)) return;
  const wrapper = document.createElement('span');
  wrapper.className = 'choice-control';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'choice-button';
  button.setAttribute('role', 'combobox');
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  const id = 'choice-' + ++nextId;
  button.setAttribute('aria-controls', id);
  const text = document.createElement('span');
  const chevron = document.createElement('span');
  chevron.className = 'choice-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  button.append(text, chevron);
  const label = select.labels?.[0]?.cloneNode(true);
  label?.querySelectorAll('input,select,button,output,small').forEach((el) => el.remove());
  const name = select.getAttribute('aria-label') || label?.textContent.trim() || '选择';
  select.before(wrapper);
  wrapper.append(select, button);
  select.tabIndex = -1;
  select.classList.add('choice-source');
  function sync() {
    const value = select.selectedOptions[0]?.textContent || '请选择';
    if (text.textContent !== value) text.textContent = value;
    button.setAttribute('aria-label', `${name}：${value}`);
    button.disabled = select.disabled || !select.options.length;
    wrapper.hidden = select.hidden;
    if (activeMenu?.button === button && (select.disabled || select.hidden || !select.isConnected))
      closeChoiceMenu();
  }
  function open() {
    if (button.disabled) return;
    if (activeMenu?.button === button) {
      closeChoiceMenu(true);
      return;
    }
    closeChoiceMenu();
    sync();
    const menu = document.createElement('div');
    menu.id = id;
    menu.className = 'choice-menu';
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', name);
    const options = [...select.options];
    let index = Math.max(0, select.selectedIndex),
      typeahead = '',
      lastType = 0;
    const enabled = (i) =>
      !!options[i] && !options[i].disabled && !options[i].parentElement?.disabled;
    const rows = options.map((option, i) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.id = `${id}-${i}`;
      row.tabIndex = -1;
      row.setAttribute('role', 'option');
      row.textContent = option.textContent;
      row.setAttribute('aria-selected', String(i === select.selectedIndex));
      row.disabled = !enabled(i);
      row.onclick = () => commit(i);
      menu.append(row);
      return row;
    });
    function highlight() {
      rows.forEach((row, i) => row.classList.toggle('highlighted', i === index));
      button.setAttribute('aria-activedescendant', `${id}-${index}`);
      // Scroll only the list. scrollIntoView also moves the containing tool window.
      const row = rows[index];
      if (row) {
        const top = row.offsetTop,
          bottom = top + row.offsetHeight;
        if (top < menu.scrollTop) menu.scrollTop = top;
        else if (bottom > menu.scrollTop + menu.clientHeight)
          menu.scrollTop = bottom - menu.clientHeight;
      }
    }
    function commit(i) {
      if (!enabled(i)) return;
      const changed = select.selectedIndex !== i;
      select.selectedIndex = i;
      closeChoiceMenu(true);
      sync();
      if (changed) {
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
        sync();
      }
    }
    function key(event) {
      if (event.key === 'Escape' || event.key === 'Tab') {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
        }
        closeChoiceMenu(event.key === 'Escape');
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        commit(index);
        return;
      }
      const delta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
      if (delta) {
        event.preventDefault();
        for (let n = 0; n < options.length; n++) {
          index = (index + delta + options.length) % options.length;
          if (enabled(index)) break;
        }
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        index =
          event.key === 'Home'
            ? options.findIndex((_, i) => enabled(i))
            : options.findLastIndex((_, i) => enabled(i));
      } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
        const now = performance.now();
        typeahead = now - lastType > 700 ? event.key : typeahead + event.key;
        lastType = now;
        const found = options.findIndex(
          (option, i) =>
            enabled(i) && option.textContent.toLowerCase().startsWith(typeahead.toLowerCase()),
        );
        if (found >= 0) index = found;
      } else return;
      highlight();
    }
    // Popovers participate in the top layer, including inside the image import dialog.
    if ('showPopover' in menu) menu.setAttribute('popover', 'manual');
    (button.closest('dialog[open]') || document.body).append(menu);
    menu.showPopover?.();
    const box = button.getBoundingClientRect(),
      viewport = window.visualViewport;
    const width = viewport?.width || innerWidth,
      height = viewport?.height || innerHeight;
    const ox = viewport?.offsetLeft || 0,
      oy = viewport?.offsetTop || 0;
    const menuWidth = Math.min(Math.max(box.width, 210), width - 16);
    const below = oy + height - box.bottom - 12,
      above = box.top - oy - 12;
    const down = below >= Math.min(280, options.length * 44 + 12) || below >= above;
    const menuHeight = Math.max(44, Math.min(320, down ? below : above));
    menu.style.width = menuWidth + 'px';
    menu.style.maxHeight = menuHeight + 'px';
    menu.style.left = Math.max(ox + 8, Math.min(ox + width - menuWidth - 8, box.left)) + 'px';
    menu.style.top =
      (down
        ? box.bottom + 6
        : Math.max(oy + 8, box.top - Math.min(menu.scrollHeight, menuHeight) - 6)) + 'px';
    const scrollPositions = new Map();
    for (let ancestor = button.parentElement; ancestor; ancestor = ancestor.parentElement)
      scrollPositions.set(ancestor, [ancestor.scrollLeft, ancestor.scrollTop]);
    activeMenu = { menu, button, select, key, scrollPositions };
    button.setAttribute('aria-expanded', 'true');
    button.focus({ preventScroll: true });
    highlight();
    void animateSurface(menu, true);
  }
  button.onclick = open;
  button.onfocus = sync;
  button.onkeydown = (event) => {
    if (activeMenu?.button === button) {
      activeMenu.key(event);
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      open();
    }
  };
  choices.set(select, { sync });
  select.addEventListener('change', sync);
  sync();
}

/** Enhance existing semantic controls; application events and form values stay intact. */
export function installControls() {
  const scan = (root) => {
    if (root.matches?.('select')) enhanceSelect(root);
    root.querySelectorAll?.('select').forEach(enhanceSelect);
    const checks = root.matches?.('input[type="checkbox"]') ? [root] : [];
    checks.push(...(root.querySelectorAll?.('input[type="checkbox"]') || []));
    checks.forEach((input) => input.setAttribute('role', 'switch'));
    if (root.querySelectorAll) updateRanges(root);
  };
  scan(document);
  const observer = new MutationObserver((records) => {
    const roots = new Set(),
      selects = new Set();
    for (const record of records) {
      if (record.type === 'attributes') {
        if (record.target.matches('select')) selects.add(record.target);
      } else {
        const select = record.target.closest?.('select');
        if (select) selects.add(select);
        for (const node of record.addedNodes) if (node.nodeType === 1) roots.add(node);
      }
    }
    for (const root of roots) scan(root);
    for (const select of selects) choices.get(select)?.sync();
    if (activeMenu && !activeMenu.button.isConnected) closeChoiceMenu();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['disabled', 'selected', 'hidden'],
  });
  document.addEventListener('input', (event) => {
    if (event.target.matches('input[type="range"]')) updateRanges(event.target.parentElement);
  });
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (
        activeMenu &&
        !activeMenu.menu.contains(event.target) &&
        !activeMenu.button.contains(event.target)
      )
        closeChoiceMenu();
    },
    true,
  );
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && activeMenu) {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeChoiceMenu(true);
      }
    },
    true,
  );
  document.addEventListener(
    'scroll',
    (event) => {
      if (!activeMenu || event.target === activeMenu.menu || activeMenu.menu.contains(event.target))
        return;
      // A focus/scroll-into-view event may be delivered after the click that opens
      // this menu. Its anchor already uses that position; dismiss only for a new scroll.
      const previous = activeMenu.scrollPositions.get(event.target);
      if (
        previous &&
        previous[0] === event.target.scrollLeft &&
        previous[1] === event.target.scrollTop
      )
        return;
      closeChoiceMenu();
    },
    true,
  );
  window.addEventListener('resize', () => closeChoiceMenu());
  window.visualViewport?.addEventListener('resize', () => closeChoiceMenu());
  document.addEventListener('contextmenu', (event) => {
    if (!event.target.closest('input,textarea,a')) event.preventDefault();
  });
}
