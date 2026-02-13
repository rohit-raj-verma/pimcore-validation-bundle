pimcore.registerNS("pimcore.plugin.PimcoreValidationBundle");

pimcore.plugin.PimcoreValidationBundle = Class.create({

    initialize: function () {
        this.rulesCache = {};
        this.rulesLoading = {};
        document.addEventListener(pimcore.events.pimcoreReady, this.pimcoreReady.bind(this));
    },

    pimcoreReady: function (e) {
        // Class editor JS is loaded lazily. Patch immediately if available, otherwise retry for a short period.
        // We patch datatype getSpecificPanelItems() (same pattern used by Pimcore's input.js regex validation).
        this.patchClassEditorWithRetry();
        this.patchClassEditorLifecycleHooksWithRetry();
        this.registerObjectSaveValidationErrorHandling();
        this.registerObjectFieldValidationIndicators();
    }

    ,

    patchClassEditorWithRetry: function () {
        var attempts = 0;
        var maxAttempts = 60; // ~30s @ 500ms

        var timer = window.setInterval(function () {
            attempts++;
            this.patchAllLoadedClassEditorDataTypes();

            if (attempts >= maxAttempts) {
                window.clearInterval(timer);
            }
        }.bind(this), 500);
    },

    patchClassEditorLifecycleHooksWithRetry: function () {
        var attempts = 0;
        var maxAttempts = 120; // ~60s @ 500ms

        var timer = window.setInterval(function () {
            attempts++;
            var done = this.patchClassEditorLifecycleHooks();

            if (done === true) {
                window.clearInterval(timer);
                return;
            }

            if (attempts >= maxAttempts) {
                window.clearInterval(timer);
            }
        }.bind(this), 500);
    },

    patchClassEditorLifecycleHooks: function () {
        if (!pimcore.object || !pimcore.object.classes || !pimcore.object.classes.klass || !pimcore.object.classes.klass.prototype) {
            return false;
        }

        var klassProto = pimcore.object.classes.klass.prototype;
        if (klassProto.pimcoreValidationLifecyclePatched === true) {
            return true;
        }
        klassProto.pimcoreValidationLifecyclePatched = true;

        var plugin = this;

        // Load persisted validation rules and apply them to the editors in the class tree.
        if (typeof klassProto.initialize === 'function') {
            var originalInitialize = klassProto.initialize;
            klassProto.initialize = function () {
                originalInitialize.apply(this, arguments);
                plugin.loadAndApplyRulesToClassEditor(this);
            };
        }

        if (typeof klassProto.addDataChild === 'function') {
            var originalAddDataChild = klassProto.addDataChild;
            klassProto.addDataChild = function (type, initData, context) {
                // Important: datatype JS may be loaded/attached lazily during the original call.
                // So patch AFTER it returns, plus a short delayed retry.
                var node = originalAddDataChild.apply(this, arguments);
                plugin.patchAllLoadedClassEditorDataTypes();
                plugin.ensureDatatypePatched(type);
                window.setTimeout(function () {
                    plugin.ensureDatatypePatched(type);
                }, 0);
                window.setTimeout(function () {
                    plugin.ensureDatatypePatched(type);
                }, 150);

                // If rules are already loaded for this class, apply immediately to the new editor.
                plugin.applyCachedRulesToNewNode(node);

                return node;
            };
        }

        if (typeof klassProto.changeDataType === 'function') {
            var originalChangeDataType = klassProto.changeDataType;
            klassProto.changeDataType = function (tree, record, type, removeExisting, context) {
                var result = originalChangeDataType.apply(this, arguments);
                plugin.patchAllLoadedClassEditorDataTypes();
                plugin.ensureDatatypePatched(type);
                window.setTimeout(function () {
                    plugin.ensureDatatypePatched(type);
                }, 0);
                window.setTimeout(function () {
                    plugin.ensureDatatypePatched(type);
                }, 150);
                return result;
            };
        }

        if (typeof klassProto.onTreeNodeClick === 'function') {
            var originalOnTreeNodeClick = klassProto.onTreeNodeClick;
            klassProto.onTreeNodeClick = function () {
                // This fires when you click any node in the class tree; perfect moment to patch newly loaded datatypes.
                var result = originalOnTreeNodeClick.apply(this, arguments);
                plugin.patchAllLoadedClassEditorDataTypes();
                return result;
            };
        }

        return true;
    },

    loadAndApplyRulesToClassEditor: function (klassInstance) {
        var classId = null;
        try {
            classId = klassInstance && klassInstance.data ? klassInstance.data.id : null;
        } catch (e) {
            classId = null;
        }

        if (!classId) {
            return;
        }

        this.loadRulesForClass(String(classId), function (rules) {
            try {
                if (!klassInstance || !klassInstance.tree || !klassInstance.tree.getRootNode) {
                    return;
                }
                var root = klassInstance.tree.getRootNode();
                this.applyRulesToTreeNode(root, rules);
            } catch (e) {
                // ignore
            }
        }.bind(this));
    },

    loadRulesForClass: function (classId, callback) {
        if (this.rulesCache[classId]) {
            callback(this.rulesCache[classId]);
            return;
        }

        if (this.rulesLoading[classId] === true) {
            // Poll briefly until loaded (simple + good enough for this use-case)
            var attempts = 0;
            var timer = window.setInterval(function () {
                attempts++;
                if (this.rulesCache[classId]) {
                    window.clearInterval(timer);
                    callback(this.rulesCache[classId]);
                } else if (attempts > 40) {
                    window.clearInterval(timer);
                    callback({});
                }
            }.bind(this), 250);
            return;
        }

        this.rulesLoading[classId] = true;

        Ext.Ajax.request({
            url: '/admin/pimcore-validation/rules',
            method: 'GET',
            params: {
                classId: classId
            },
            success: function (response) {
                var payload = Ext.decode(response.responseText, true) || {};
                this.rulesCache[classId] = payload.rules || {};
                this.rulesLoading[classId] = false;
                callback(this.rulesCache[classId]);
            }.bind(this),
            failure: function () {
                this.rulesCache[classId] = {};
                this.rulesLoading[classId] = false;
                callback({});
            }.bind(this)
        });
    },

    applyRulesToTreeNode: function (node, rules) {
        if (!node) {
            return;
        }

        try {
            // Pimcore class tree nodes store editor on node.data.editor
            if (node.data && node.data.type === 'data' && node.data.editor && node.data.editor.datax) {
                var fieldName = node.data.editor.datax.name;
                if (fieldName && rules && rules[fieldName]) {
                    node.data.editor.datax.pimcoreValidation = rules[fieldName];
                }
            }
        } catch (e) {
            // ignore
        }

        if (node.childNodes && node.childNodes.length) {
            for (var i = 0; i < node.childNodes.length; i++) {
                this.applyRulesToTreeNode(node.childNodes[i], rules);
            }
        }
    },

    applyCachedRulesToNewNode: function (node) {
        try {
            if (!node || !node.data || !node.data.editor || !node.data.editor.datax) {
                return;
            }

            var tree = node.getOwnerTree ? node.getOwnerTree() : null;
            var root = tree ? tree.getRootNode() : null;
            var classId = root && root.data ? root.data.classId : null;
            if (!classId) {
                return;
            }

            var rules = this.rulesCache[String(classId)] || null;
            if (!rules) {
                return;
            }

            var fieldName = node.data.editor.datax.name;
            if (fieldName && rules[fieldName]) {
                node.data.editor.datax.pimcoreValidation = rules[fieldName];
            }
        } catch (e) {
            // ignore
        }
    },

    registerObjectFieldValidationIndicators: function () {
        document.addEventListener(pimcore.events.postOpenObject, function (e) {
            try {
                if (!e || !e.detail || !e.detail.object) {
                    return;
                }

                var obj = e.detail.object;
                if (!obj.data || !obj.data.general || !obj.data.general.classId) {
                    return;
                }

                var classId = String(obj.data.general.classId);
                this.loadRulesForClass(classId, function (rules) {
                    this.applyValidationIndicatorsToObject(obj, rules);
                }.bind(this));
            } catch (e2) {
                // ignore
            }
        }.bind(this));
    },

    applyValidationIndicatorsToObject: function (obj, rules) {
        if (!obj || !obj.tab || !obj.tab.queryBy || !rules) {
            return;
        }

        var tab = obj.tab;
        var keys;
        try {
            keys = Object.keys(rules);
        } catch (e) {
            return;
        }

        for (var i = 0; i < keys.length; i++) {
            var fieldName = keys[i];
            var cfg = rules[fieldName];
            if (!cfg || cfg.enabled !== true) {
                continue;
            }

            // Find visible form fields with matching name
            var fields = tab.queryBy(function (item) {
                try {
                    if (!item || item.isFormField !== true) {
                        return false;
                    }
                    var n = item.getName ? item.getName() : item.name;
                    return n === fieldName;
                } catch (e2) {
                    return false;
                }
            });

            if (!fields || fields.length === 0) {
                continue;
            }

            for (var j = 0; j < fields.length; j++) {
                this.decorateObjectFieldLabel(fields[j], cfg);
            }
        }
    },

    decorateObjectFieldLabel: function (field, cfg) {
        if (!field || field.pimcoreValidationIndicatorApplied === true) {
            return;
        }
        field.pimcoreValidationIndicatorApplied = true;

        var label = field.fieldLabel || '';
        if (String(label).indexOf('pimcoreValidationIndicator') !== -1) {
            return;
        }

        var format = cfg && cfg.format ? String(cfg.format) : 'none';
        var tooltip = 'Validation: ' + format;

        // Small red dot with tooltip (no label text)
        var indicator = ' <span class="pimcoreValidationIndicator" ' +
            'style="display:inline-block;margin-left:6px;width:8px;height:8px;border-radius:50%;background:#d9534f;vertical-align:middle;" ' +
            'data-qtip="' + Ext.util.Format.htmlEncode(tooltip) + '"></span>';

        if (typeof field.setFieldLabel === 'function') {
            field.setFieldLabel(label + indicator);
        }
    },

    ensureDatatypePatched: function (key) {
        try {
            if (!pimcore || !pimcore.object || !pimcore.object.classes || !pimcore.object.classes.data) {
                return false;
            }

            var klass = pimcore.object.classes.data[key];
            if (!klass || !klass.prototype) {
                return false;
            }

            // IMPORTANT: Prototype.js inheritance / Pimcore datatypes can make "patched markers" appear via inheritance.
            // Therefore: only consider a datatype patched when the specific function we wrap is wrapped by us.
            var isWrapped = function (fn) {
                try {
                    return !!(fn
                        && Object.prototype.hasOwnProperty.call(fn, '__pimcoreValidationWrapped')
                        && fn.__pimcoreValidationWrapped === true);
                } catch (e) {
                    return false;
                }
            };

            if (typeof klass.prototype.getSpecificPanelItems === 'function') {
                if (isWrapped(klass.prototype.getSpecificPanelItems)) {
                    return true;
                }
                this.patchDatatypeGetSpecificPanelItems(klass, key);
                return true;
            }

            if (typeof klass.prototype.getLayout === 'function') {
                if (isWrapped(klass.prototype.getLayout)) {
                    return true;
                }
                this.patchDatatypeGetLayoutFallback(klass, key);
                return true;
            }

            return false;
        } catch (e) {
            return false;
        }
    },

    /**
     * Pimcore adds "Regular Expression Validation" for inputs by implementing getSpecificPanelItems()
     * (see `pimcore/object/classes/data/input.js`). We follow the same extension point.
     */
    patchAllLoadedClassEditorDataTypes: function () {
        if (!pimcore.object || !pimcore.object.classes || !pimcore.object.classes.data) {
            return false;
        }

        var dataNs = pimcore.object.classes.data;
        var keys;
        try {
            keys = Object.keys(dataNs);
        } catch (e) {
            return false;
        }

        var patchedAny = false;
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var klass = dataNs[key];

            if (!klass || !klass.prototype) {
                continue;
            }

            // Delegate to single-type patcher (also used by class editor hooks)
            if (this.ensureDatatypePatched(key) === true) {
                patchedAny = true;
            }
        }

        return patchedAny;
    },

    patchDatatypeGetSpecificPanelItems: function (klass, key) {
        var plugin = this;
        var originalFn = klass.prototype.getSpecificPanelItems;

        var wrapped = function () {
            var items = originalFn.apply(this, arguments);
  
            if (typeof this.isInCustomLayoutEditor === 'function' && this.isInCustomLayoutEditor()) {
                return items;
            }

            if (!Ext.isArray(items)) {
                items = items ? [items] : [];
            }

            var hasFieldset = false;
            for (var i = 0; i < items.length; i++) {
                var it = items[i];
                try {
                    if (!it) {
                        continue;
                    }
                    if (typeof it.getItemId === 'function' && it.getItemId() === 'pimcoreValidationFieldset') {
                        hasFieldset = true;
                        break;
                    }
                    if (it.itemId && it.itemId === 'pimcoreValidationFieldset') {
                        hasFieldset = true;
                        break;
                    }
                } catch (e) {
                    // ignore
                }
            }

            if (hasFieldset !== true) {
                items.push(plugin.buildValidationFieldset(this));
            }

            return items;
        };

        wrapped.__pimcoreValidationWrapped = true;
        klass.prototype.getSpecificPanelItems = wrapped;
    },

    patchDatatypeGetLayoutFallback: function (klass, key) {
        var plugin = this;
        var originalFn = klass.prototype.getLayout;

        var wrapped = function () {
            var layout = originalFn.apply(this, arguments);

            if (typeof this.isInCustomLayoutEditor === 'function' && this.isInCustomLayoutEditor()) {
                return layout;
            }

            if (!this.specificPanel || typeof this.specificPanel.add !== 'function') {
                return layout;
            }

            var existing = null;
            try {
                existing = this.specificPanel.getComponent('pimcoreValidationFieldset');
            } catch (e) {
                existing = null;
            }
            if (!existing) {
                try {
                    existing = this.specificPanel.down ? this.specificPanel.down('#pimcoreValidationFieldset') : null;
                } catch (e2) {
                    existing = null;
                }
            }

            if (!existing) {
                this.specificPanel.add(plugin.buildValidationFieldset(this));
            }
            this.specificPanel.updateLayout();

            return layout;
        };

        wrapped.__pimcoreValidationWrapped = true;
        klass.prototype.getLayout = wrapped;
    },

    buildValidationFieldset: function (fieldEditor) {
        var initial = fieldEditor.datax && fieldEditor.datax.pimcoreValidation ? fieldEditor.datax.pimcoreValidation : {};

        var enabled = new Ext.form.field.Checkbox({
            fieldLabel: t('pimcore_validation_enable'),
            name: 'pimcoreValidationEnabledInternal',
            checked: !!(initial.enabled)
        });

        var required = new Ext.form.field.Checkbox({
            fieldLabel: t('pimcore_validation_required'),
            name: 'pimcoreValidationRequiredInternal',
            checked: !!(initial.required)
        });

        var format = new Ext.form.ComboBox({
            fieldLabel: t('pimcore_validation_format'),
            name: 'pimcoreValidationFormatInternal',
            queryMode: 'local',
            editable: false,
            valueField: 'value',
            displayField: 'text',
            store: new Ext.data.ArrayStore({
                fields: ['value', 'text'],
                data: [
                    ['none', t('pimcore_validation_format_none')],
                    ['email', t('pimcore_validation_format_email')],
                    ['phone', t('pimcore_validation_format_phone')],
                    ['regex', t('pimcore_validation_format_regex')],
                    ['alpha', t('pimcore_validation_format_alpha')],
                    ['alphanumeric', t('pimcore_validation_format_alphanumeric')],
                    ['numeric', t('pimcore_validation_format_numeric')],
                    ['length', t('pimcore_validation_format_length')],
                    ['range', t('pimcore_validation_format_range')]
                ]
            }),
            value: initial.format ? initial.format : 'none',
            width: 300
        });

        var regex = new Ext.form.field.Text({
            fieldLabel: t('pimcore_validation_regex'),
            name: 'pimcoreValidationRegexInternal',
            value: initial.regex ? initial.regex : '',
            width: 540
        });

        var message = new Ext.form.field.Text({
            fieldLabel: t('pimcore_validation_message'),
            name: 'pimcoreValidationMessageInternal',
            value: initial.message ? initial.message : '',
            width: 540
        });

        var minLength = new Ext.form.field.Number({
            fieldLabel: t('pimcore_validation_min_length'),
            name: 'pimcoreValidationMinLengthInternal',
            value: (typeof initial.minLength === 'number') ? initial.minLength : null,
            minValue: 0,
            allowDecimals: false,
            width: 300
        });

        var maxLength = new Ext.form.field.Number({
            fieldLabel: t('pimcore_validation_max_length'),
            name: 'pimcoreValidationMaxLengthInternal',
            value: (typeof initial.maxLength === 'number') ? initial.maxLength : null,
            minValue: 0,
            allowDecimals: false,
            width: 300
        });

        var minValue = new Ext.form.field.Number({
            fieldLabel: t('pimcore_validation_min_value'),
            name: 'pimcoreValidationMinValueInternal',
            value: (typeof initial.min === 'number') ? initial.min : null,
            width: 300
        });

        var maxValue = new Ext.form.field.Number({
            fieldLabel: t('pimcore_validation_max_value'),
            name: 'pimcoreValidationMaxValueInternal',
            value: (typeof initial.max === 'number') ? initial.max : null,
            width: 300
        });

        var updateVisibility = function () {
            var isEnabled = enabled.getValue() === true;
            var type = format.getValue() || 'none';
            required.setDisabled(!isEnabled);
            format.setDisabled(!isEnabled);
            regex.setDisabled(!isEnabled || type !== 'regex');
            minLength.setDisabled(!isEnabled || type !== 'length');
            maxLength.setDisabled(!isEnabled || type !== 'length');
            minValue.setDisabled(!isEnabled || type !== 'range');
            maxValue.setDisabled(!isEnabled || type !== 'range');
            message.setDisabled(!isEnabled);

            minLength.setHidden(!(isEnabled && type === 'length'));
            maxLength.setHidden(!(isEnabled && type === 'length'));
            minValue.setHidden(!(isEnabled && type === 'range'));
            maxValue.setHidden(!(isEnabled && type === 'range'));
        };

        enabled.on('change', updateVisibility);
        format.on('change', updateVisibility);
        updateVisibility();

        // Store as a real object into field definition JSON:
        // pimcore.object.classes.data.data.applyData() will call getValue() and put it into datax["pimcoreValidation"].
        var fieldset = new Ext.form.FieldSet({
            itemId: 'pimcoreValidationFieldset',
            title: t('pimcore_validation_title'),
            collapsible: true,
            collapsed: !(initial && initial.enabled),
            style: "margin-top: 10px;",
            name: 'pimcoreValidation',
            items: [
                enabled,
                required,
                format,
                regex,
                minLength,
                maxLength,
                minValue,
                maxValue,
                message
            ]
        });

        fieldset.getValue = function () {
            var ml = minLength.getValue();
            var xl = maxLength.getValue();
            var mn = minValue.getValue();
            var mx = maxValue.getValue();

            return {
                enabled: enabled.getValue() === true,
                required: required.getValue() === true,
                format: format.getValue() || 'none',
                regex: regex.getValue() || '',
                minLength: (ml === null || typeof ml === 'undefined') ? null : Number(ml),
                maxLength: (xl === null || typeof xl === 'undefined') ? null : Number(xl),
                min: (mn === null || typeof mn === 'undefined') ? null : Number(mn),
                max: (mx === null || typeof mx === 'undefined') ? null : Number(mx),
                message: message.getValue() || ''
            };
        };

        return fieldset;
    },

    registerObjectSaveValidationErrorHandling: function () {
        if (!Ext || !Ext.Ajax || Ext.Ajax.pimcoreValidationPatched === true) {
            return;
        }

        Ext.Ajax.pimcoreValidationPatched = true;

        Ext.Ajax.on('requestexception', function (conn, response, options) {
            try {
                if (!options || !options.url || String(options.url).indexOf('/admin/object/save') === -1) {
                    return;
                }

                if (!response || !response.responseText) {
                    return;
                }

                var data = Ext.decode(response.responseText, true);
                if (!data || data.type !== 'ValidationException' || !data.message) {
                    return;
                }

                // Pimcore core already shows the ValidationException popup/notification.
                // We only add inline field errors to avoid duplicate popups.
                var fieldErrors = this.extractFieldErrorsFromMessage(String(data.message));
                this.applyFieldErrorsToVisibleFormFields(fieldErrors);
            } catch (e) {
                // ignore
            }
        }.bind(this));
    },

    /**
     * @return Object<string, string[]> map fieldName => messages
     */
    extractFieldErrorsFromMessage: function (message) {
        var result = {};
        var parts = String(message).split(' / ');

        for (var i = 0; i < parts.length; i++) {
            var part = parts[i];
            var idx = part.lastIndexOf('fieldname=');
            if (idx === -1) {
                continue;
            }

            var msg = String(part.substring(0, idx)).replace(/^Validation failed:\s*/i, '').trim();
            var fieldName = String(part.substring(idx + 'fieldname='.length)).trim();

            if (!fieldName) {
                continue;
            }

            if (!result[fieldName]) {
                result[fieldName] = [];
            }
            if (msg) {
                result[fieldName].push(msg);
            }
        }

        return result;
    },

    applyFieldErrorsToVisibleFormFields: function (fieldErrors) {
        if (!fieldErrors) {
            return;
        }

        var fieldNames = Object.keys(fieldErrors);
        for (var i = 0; i < fieldNames.length; i++) {
            var fieldName = fieldNames[i];
            var messages = fieldErrors[fieldName] || [];
            if (messages.length === 0) {
                continue;
            }

            // Mark matching form fields invalid (best-effort; works for most simple fields).
            var fields = Ext.ComponentQuery.query('[name=' + fieldName + ']');
            if (!fields || fields.length === 0) {
                // try with quotes (in case of special chars)
                fields = Ext.ComponentQuery.query('[name="' + fieldName + '"]');
            }

            for (var j = 0; j < fields.length; j++) {
                if (fields[j] && typeof fields[j].markInvalid === 'function') {
                    fields[j].markInvalid(messages.join('<br>'));
                }
            }
        }
    }
});

var PimcoreValidationBundlePlugin = new pimcore.plugin.PimcoreValidationBundle();
