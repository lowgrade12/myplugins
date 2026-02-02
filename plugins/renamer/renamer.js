(function () {
  "use strict";

  // ============================================
  // CONSTANTS
  // ============================================
  
  // Maximum number of retries when looking for the directory filter input
  const MAX_INITIALIZATION_RETRIES = 10;
  // Delay in milliseconds between retries
  const RETRY_DELAY_MS = 500;
  // Delay in milliseconds before initial check after page load
  const INITIAL_LOAD_DELAY_MS = 1000;

  // ============================================
  // GRAPHQL QUERIES
  // ============================================

  async function graphqlQuery(query, variables = {}) {
    const response = await fetch("/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
    const result = await response.json();
    if (result.errors) {
      console.error("[Renamer] GraphQL error:", result.errors);
      throw new Error(result.errors[0].message);
    }
    return result.data;
  }

  /**
   * Fetch library paths from Stash configuration
   * @returns {Promise<string[]>} Array of library paths
   */
  async function fetchLibraryPaths() {
    const query = `
      query Configuration {
        configuration {
          general {
            stashes {
              path
            }
          }
        }
      }
    `;
    
    const data = await graphqlQuery(query);
    const stashes = data?.configuration?.general?.stashes || [];
    return stashes.map(s => s.path);
  }

  /**
   * Get the current plugin configuration
   * @returns {Promise<object>} Plugin configuration
   */
  async function getPluginConfig() {
    const query = `
      query Configuration {
        configuration {
          plugins
        }
      }
    `;
    
    const data = await graphqlQuery(query);
    return data?.configuration?.plugins?.renamer || {};
  }

  /**
   * Save plugin configuration
   * @param {object} pluginConfig - The plugin configuration to save
   */
  async function savePluginConfig(pluginConfig) {
    const mutation = `
      mutation ConfigurePlugin($pluginId: ID!, $input: Map!) {
        configurePlugin(plugin_id: $pluginId, input: $input)
      }
    `;
    
    await graphqlQuery(mutation, {
      pluginId: "renamer",
      input: pluginConfig
    });
  }

  /**
   * Check if we're on the plugins settings page
   * @returns {boolean}
   */
  function isPluginSettingsPage() {
    return window.location.pathname.includes("/settings") && 
           window.location.search.includes("tab=plugins");
  }

  /**
   * Find the Directory filter input field in the Renamer plugin settings
   * @returns {HTMLInputElement|null}
   */
  function findDirectoryFilterInput() {
    // Look for the Renamer plugin section
    const pluginCards = document.querySelectorAll('.plugin-settings');
    
    for (const card of pluginCards) {
      // Check if this is the Renamer plugin by looking for its name
      const header = card.querySelector('.card-header, h6, .plugin-name');
      if (header && header.textContent.toLowerCase().includes('renamer')) {
        // Find all form groups in this card
        const formGroups = card.querySelectorAll('.form-group, .mb-3, .setting-row');
        
        for (const group of formGroups) {
          const label = group.querySelector('label');
          if (label && label.textContent.toLowerCase().includes('directory filter')) {
            // Found the Directory filter setting
            const input = group.querySelector('input[type="text"]');
            return { input, formGroup: group };
          }
        }
      }
    }
    
    // Alternative approach: search for input by its setting name
    const allInputs = document.querySelectorAll('input[type="text"]');
    for (const input of allInputs) {
      const parent = input.closest('.form-group, .mb-3, .setting-row');
      if (parent) {
        const label = parent.querySelector('label');
        if (label && label.textContent.toLowerCase().includes('directory filter')) {
          return { input, formGroup: parent };
        }
      }
    }
    
    return null;
  }

  /**
   * Create and add the directory dropdown
   * @param {string[]} libraryPaths - Array of library paths
   * @param {HTMLElement} formGroup - The form group element containing the input
   * @param {HTMLInputElement} input - The directory filter input
   */
  function addDirectoryDropdown(libraryPaths, formGroup, input) {
    // Check if dropdown already exists
    if (formGroup.querySelector('.renamer-directory-dropdown')) {
      return;
    }

    // Create container for dropdown
    const dropdownContainer = document.createElement('div');
    dropdownContainer.className = 'renamer-directory-dropdown mt-2';
    
    // Create label
    const dropdownLabel = document.createElement('small');
    dropdownLabel.className = 'text-muted d-block mb-1';
    dropdownLabel.textContent = 'Quick select from library paths:';
    
    // Create select element
    const select = document.createElement('select');
    select.className = 'form-control form-select';
    select.style.cssText = 'max-width: 100%;';
    
    // Add default option
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = '-- Select a directory --';
    select.appendChild(defaultOption);
    
    // Add library path options
    for (const path of libraryPaths) {
      const option = document.createElement('option');
      option.value = path;
      option.textContent = path;
      select.appendChild(option);
    }
    
    // Set current value if it matches a library path
    if (input.value && libraryPaths.includes(input.value)) {
      select.value = input.value;
    }
    
    // Handle selection change
    select.addEventListener('change', function() {
      if (this.value) {
        input.value = this.value;
        // Trigger input event to notify Stash of the change
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    
    // Update dropdown when input changes manually
    input.addEventListener('input', function() {
      if (libraryPaths.includes(this.value)) {
        select.value = this.value;
      } else {
        select.value = '';
      }
    });
    
    // Assemble and insert
    dropdownContainer.appendChild(dropdownLabel);
    dropdownContainer.appendChild(select);
    
    // Insert after the input's parent (input-group or direct parent)
    const inputParent = input.closest('.input-group') || input;
    inputParent.parentNode.insertBefore(dropdownContainer, inputParent.nextSibling);
  }

  /**
   * Initialize the directory dropdown enhancement
   */
  async function initializeDirectoryDropdown() {
    if (!isPluginSettingsPage()) {
      return;
    }

    try {
      // Fetch library paths
      const libraryPaths = await fetchLibraryPaths();
      
      if (libraryPaths.length === 0) {
        console.log('[Renamer] No library paths configured');
        return;
      }
      
      // Find the Directory filter input
      const result = findDirectoryFilterInput();
      
      if (result && result.input && result.formGroup) {
        addDirectoryDropdown(libraryPaths, result.formGroup, result.input);
        console.log('[Renamer] Directory dropdown added successfully');
      } else {
        console.log('[Renamer] Directory filter input not found yet, will retry');
      }
    } catch (error) {
      console.error('[Renamer] Error initializing directory dropdown:', error);
    }
  }

  // ============================================
  // MUTATION OBSERVER
  // ============================================

  /**
   * Set up mutation observer to detect when plugin settings are loaded
   */
  function setupObserver() {
    let initialized = false;
    let retryCount = 0;
    let retryPending = false;
    
    const observer = new MutationObserver((mutations) => {
      if (!isPluginSettingsPage()) {
        initialized = false;
        return;
      }
      
      // Check if the Renamer plugin settings are visible
      if (!initialized && !retryPending) {
        const result = findDirectoryFilterInput();
        if (result) {
          initialized = true;
          initializeDirectoryDropdown();
        } else if (retryCount < MAX_INITIALIZATION_RETRIES) {
          retryCount++;
          retryPending = true;
          // Retry after a short delay
          setTimeout(() => {
            retryPending = false;
            const retryResult = findDirectoryFilterInput();
            if (retryResult) {
              initialized = true;
              initializeDirectoryDropdown();
            }
          }, RETRY_DELAY_MS);
        }
      }
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    
    // Also check on URL changes (for SPA navigation)
    window.addEventListener('popstate', () => {
      initialized = false;
      retryCount = 0;
      retryPending = false;
    });
  }

  // ============================================
  // INITIALIZATION
  // ============================================

  function init() {
    console.log('[Renamer] Directory dropdown enhancement loaded');
    setupObserver();
    
    // Initial check if already on the right page
    if (document.readyState === 'complete') {
      setTimeout(initializeDirectoryDropdown, INITIAL_LOAD_DELAY_MS);
    } else {
      window.addEventListener('load', () => {
        setTimeout(initializeDirectoryDropdown, INITIAL_LOAD_DELAY_MS);
      });
    }
  }

  // Wait for PluginApi if available, otherwise start directly
  if (typeof PluginApi !== 'undefined') {
    PluginApi.Event.addEventListener('stash:page:loaded', init);
  } else {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }
})();
