// Runs at document_start. Installs a MutationObserver on document to record
// runtime attribute changes made by page scripts (reveal classes, carousel styles, etc.)
// so whole-element saves can restore the original values from the file.
(function () {
  if (globalThis.__retouchRuntime) return;

  const recordedAttrs = new WeakMap();
  const recordedText = new WeakMap();
  const recordedParentText = new WeakMap();
  let ownershipPredicate = () => false;
  let isBusy = false;
  let busyTimer = null;

  function isOwned(node) {
    try {
      return ownershipPredicate(node);
    } catch {
      return false;
    }
  }

  function shouldSkipAttr(record) {
    const name = record.attributeName;
    if (!name || name.startsWith('data-retouch-') || name === 'contenteditable') return true;
    const target = record.target;
    if (!target || target.nodeType !== 1) return true;
    if (target.closest) {
      if (target.closest('[data-retouch-ui]')) return true;
    } else if (target.hasAttribute && target.hasAttribute('data-retouch-ui')) {
      return true;
    }
    if (isBusy && isOwned(target)) return true;
    return false;
  }

  function shouldSkipText(target) {
    if (!target) return true;
    const el = target.nodeType === 1 ? target : target.parentElement;
    if (!el) return true;
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'title') return true;
    if (el.closest) {
      if (el.closest('script, style, title, [data-retouch-ui]')) return true;
    } else if (el.hasAttribute && el.hasAttribute('data-retouch-ui')) {
      return true;
    }
    if (isBusy && isOwned(target)) return true;
    return false;
  }

  function processRecord(record) {
    if (record.type === 'attributes') {
      if (shouldSkipAttr(record)) return;
      const el = record.target;
      const name = record.attributeName;
      let map = recordedAttrs.get(el);
      if (!map) {
        map = new Map();
        recordedAttrs.set(el, map);
      }
      if (!map.has(name)) {
        map.set(name, {
          original: record.oldValue,
          last: el.getAttribute(name)
        });
      } else {
        map.get(name).last = el.getAttribute(name);
      }
    } else if (record.type === 'characterData') {
      const node = record.target;
      if (shouldSkipText(node)) return;
      let entry = recordedText.get(node);
      if (!entry) {
        recordedText.set(node, {
          original: record.oldValue,
          last: node.data
        });
      } else {
        entry.last = node.data;
      }
    } else if (record.type === 'childList') {
      const parent = record.target;
      if (shouldSkipText(parent)) return;
      const removed = record.removedNodes;
      if (!removed || removed.length === 0) {
        const existing = recordedParentText.get(parent);
        if (existing) {
          existing.last = parent.textContent;
        }
        return;
      }

      let hasElement = false;
      let allText = true;
      let removedText = '';
      for (let i = 0; i < removed.length; i++) {
        const n = removed[i];
        if (n.nodeType === 1) {
          hasElement = true;
          allText = false;
        } else if (n.nodeType === 3) {
          removedText += n.data;
        } else {
          allText = false;
        }
      }

      if (hasElement) {
        let entry = recordedParentText.get(parent);
        if (!entry) {
          entry = { restructured: true, original: null, last: parent.textContent };
          recordedParentText.set(parent, entry);
        } else {
          entry.restructured = true;
          entry.last = parent.textContent;
        }
      } else if (allText) {
        let entry = recordedParentText.get(parent);
        if (!entry) {
          entry = {
            original: removedText,
            last: parent.textContent
          };
          recordedParentText.set(parent, entry);
        } else {
          entry.last = parent.textContent;
        }
      }
    }
  }

  function processRecords(records) {
    for (const record of records) {
      processRecord(record);
    }
  }

  const observer = new MutationObserver((records) => {
    processRecords(records);
  });

  observer.observe(document, {
    subtree: true,
    attributes: true,
    attributeOldValue: true,
    characterData: true,
    characterDataOldValue: true,
    childList: true
  });

  function flush() {
    processRecords(observer.takeRecords());
  }

  function busy() {
    isBusy = true;
    if (busyTimer) clearTimeout(busyTimer);
    busyTimer = setTimeout(() => {
      flush();
      isBusy = false;
      busyTimer = null;
    }, 0);
  }

  function ignore(fn) {
    flush();
    try {
      fn();
    } finally {
      observer.takeRecords();
    }
  }

  function entry(el, name) {
    flush();
    const map = recordedAttrs.get(el);
    return map ? map.get(name) : undefined;
  }

  function entries(el) {
    flush();
    const map = recordedAttrs.get(el);
    return map ? map.entries() : undefined;
  }

  function seed(el, name, original, last) {
    flush();
    if (!el || !name) return;
    let map = recordedAttrs.get(el);
    if (!map) {
      map = new Map();
      recordedAttrs.set(el, map);
    }
    map.set(name, { original, last });
  }

  function seedText(node, original, last) {
    flush();
    if (!node) return;
    recordedText.set(node, { original, last });
  }

  function textEntry(node) {
    flush();
    if (!node) return undefined;
    if (node.nodeType === 3) {
      const direct = recordedText.get(node);
      if (direct) return direct;
      if (node.parentElement) {
        return recordedParentText.get(node.parentElement);
      }
      return undefined;
    }
    if (node.nodeType === 1) {
      return recordedParentText.get(node);
    }
    return undefined;
  }

  function setOwnership(fn) {
    if (typeof fn === 'function') ownershipPredicate = fn;
  }

  globalThis.__retouchRuntime = {
    setOwnership,
    busy,
    ignore,
    entry,
    entries,
    seed,
    seedText,
    textEntry
  };
})();
