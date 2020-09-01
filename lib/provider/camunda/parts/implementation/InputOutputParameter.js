'use strict';

var is = require('bpmn-js/lib/util/ModelUtil').is;

var domQuery = require('min-dom').query;

var elementHelper = require('../../../../helper/ElementHelper'),
    inputOutputHelper = require('../../../../helper/InputOutputHelper'),
    cmdHelper = require('../../../../helper/CmdHelper'),
    utils = require('../../../../Utils');

var entryFactory = require('../../../../factory/EntryFactory'),
    scriptImplementation = require('./Script');

var EXPRESSION_CLAUSE_PLACEHOLDER = '${}';


module.exports = function(element, bpmnFactory, options, translate) {

  // todo(pinussilvestrus): remove me
  var typeInfo = {
    'camunda:Map': {
      value: 'map',
      label: translate('Map')
    },
    'camunda:List': {
      value: 'list',
      label: translate('List')
    },
    'camunda:Script': {
      value: 'script',
      label: translate('Script')
    }
  };

  options = options || {};

  var insideConnector = !!options.insideConnector,
      idPrefix = options.idPrefix || '';

  var getSelected = options.getSelectedParameter;

  if (!ensureInputOutputSupported(element, insideConnector)) {
    return [];
  }

  var entries = [];

  var isSelected = function(element, node) {
    return getSelected(element, node);
  };


  // parameter name ////////////////////////////////////////////////////////

  entries.push(entryFactory.validationAwareTextField({
    id: idPrefix + 'parameterName',
    label: translate('Name'),
    modelProperty: 'name',

    getProperty: function(element, node) {
      return (getSelected(element, node) || {}).name;
    },

    setProperty: function(element, values, node) {
      var param = getSelected(element, node);
      return cmdHelper.updateBusinessObject(element, param, values);
    },

    validate: function(element, values, node) {
      var bo = getSelected(element, node);

      var validation = {};
      if (bo) {
        var nameValue = values.name;

        if (nameValue) {
          if (utils.containsSpace(nameValue)) {
            validation.name = translate('Name must not contain spaces');
          }
        } else {
          validation.name = translate('Parameter must have a name');
        }
      }

      return validation;
    },

    hidden: function(element, node) {
      return !isSelected(element, node);
    }
  }));


  // parameter type ///////////////////////////////////////////

  var selectTypeEntry = entryFactory.selectBox({
    id : idPrefix + 'parameterType',
    label: translate('Type'),
    selectOptions: function(element, node) {
      var bo = getSelected(element, node),
          variableLabel =
            'Assign from ' + (isInputParameter(bo) ? 'Process ' : 'Element ') + 'Variable';

      return [
        { value: 'variable', name: variableLabel },
        { value: 'constant-value', name: translate('Constant Value') },
        { value: 'expression', name: translate('Expression') },
        { value: 'script', name: translate('Script') },
        { value: 'list', name: translate('List') },
        { value: 'map', name: translate('Map') }
      ];
    },
    modelProperty: 'parameterType',
    get: function(element, node) {
      var bo = getSelected(element, node);

      if (getCurrentParameter() !== bo) {
        clearState();
        setCurrentParameter(bo);
      }

      var parameterType = inputOutputHelper.getParameterType(bo, this.__currentType);

      if (bo && !this.__currentType) {
        this.__currentType = parameterType.value;
      }

      return {
        parameterType: (parameterType || {}).value
      };
    },
    set: function(element, values, node) {
      var bo = getSelected(element, node),
          parameterType = values.parameterType;

      var properties = {
        definition: undefined,
      };

      // todo(pinussilvestrus): refactor me
      if (parameterType === 'script' || parameterType === 'list' || parameterType === 'map') {
        properties.value = undefined;
      } else {

        // handle changes which would have gone lost due to validation
        properties.value = getCurrentValue() || bo.value;
        clearCurrentValue();
      }

      // we need this to force type changes
      this.__currentType = parameterType;

      var createParameterTypeElem = function(type) {
        return createElement(type, bo, bpmnFactory);
      };


      if (parameterType === 'script') {
        properties.definition = createParameterTypeElem('camunda:Script');
      }
      else if (parameterType === 'list') {
        properties.definition = createParameterTypeElem('camunda:List');
      }
      else if (parameterType === 'map') {
        properties.definition = createParameterTypeElem('camunda:Map');
      }

      return cmdHelper.updateBusinessObject(element, bo, properties);
    },

    hidden: function(element, node) {
      return !isSelected(element, node);
    }
  });

  // persist paramater value and type changes for type switches
  var getCurrentType = function() {
    return selectTypeEntry.__currentType;
  };

  var clearCurrentType = function() {
    delete selectTypeEntry.__currentType;
  };

  var getCurrentValue = function() {
    return selectTypeEntry.__currentValue;
  };

  var setCurrentValue = function(value) {
    selectTypeEntry.__currentValue = value;
  };

  var clearCurrentValue = function(value) {
    delete selectTypeEntry.__currentValue;
  };

  var setCurrentParameter = function(parameter) {
    selectTypeEntry.__currentParameter = parameter;
  };

  var getCurrentParameter = function() {
    return selectTypeEntry.__currentParameter;
  };

  var clearCurrentParameter = function() {
    delete selectTypeEntry.__currentParameter;
  };

  var clearState = function() {
    clearCurrentValue();
    clearCurrentType();
    clearCurrentParameter();
  };

  entries.push(selectTypeEntry);


  // parameter value (type = variable) //////////////////////////////////////////////////

  entries.push(entryFactory.validationAwareTextField({
    id : idPrefix + 'parameterType-variable',
    label : translate('Variable Name'),
    modelProperty: 'value',
    getProperty: function(element, node) {
      var bo = getSelected(element, node),
          value = (bo || {}).value;

      if (value) {
        value = removeExpressionClauses(value);
      }

      return value;
    },

    setProperty: function(element, values, node) {
      var bo = getSelected(element, node),
          value = values.value;

      // ensure expression clauses wasn't inserted manually
      if (
        values.hasOwnProperty('value') &&
        !!value &&
        !inputOutputHelper.isExpression(value)) {
        values.value = appendExpressionClauses(value);
      }

      return cmdHelper.updateBusinessObject(element, bo, values);
    },

    hidden: function(element, node) {
      var bo = getSelected(element, node),
          parameterType = inputOutputHelper.getParameterType(bo, getCurrentType());

      return !(parameterType && parameterType.value === 'variable');
    },

    validate: function(element, values, node) {
      var bo = getSelected(element, node),
          value = values.value,
          currentType = getCurrentType();

      if (!value || currentType !== 'variable') {
        return;
      }

      clearCurrentValue();

      value = appendExpressionClauses(value);

      var validation = inputOutputHelper.validateVariableExpression(value);

      if (validation) {
        var validationText = translate(validation.value),
            allParameterTypes = inputOutputHelper.getAllParameterTypes(bo);

        validationText += ' ' + translate('Consider change to type "' +
          (allParameterTypes[!inputOutputHelper.validateConstantValue(value) ? 'constant-value' : 'expression'].label) +
          '".');

        validation.value = validationText;
        setCurrentValue(value);
      }

      return validation;
    }

  }));


  // parameter value (type = constant-value) //////////////////////////////////////////

  entries.push(entryFactory.validationAwareTextField({
    id : idPrefix + 'parameterType-constant-value',
    label : translate('Value'),
    modelProperty: 'value',
    getProperty: function(element, node) {
      return (getSelected(element, node) || {}).value;
    },

    setProperty: function(element, values, node) {
      var param = getSelected(element, node);
      return cmdHelper.updateBusinessObject(element, param, values);
    },

    hidden: function(element, node) {
      var bo = getSelected(element, node),
          parameterType = inputOutputHelper.getParameterType(bo, getCurrentType());

      return !(parameterType && parameterType.value === 'constant-value');
    },

    validate: function(element, values, node) {
      var bo = getSelected(element, node),
          value = values.value,
          currentType = getCurrentType();

      if (!value || currentType !== 'constant-value') {
        return;
      }

      clearCurrentValue();

      var validation = inputOutputHelper.validateConstantValue(value);

      if (validation) {
        var validationText = translate(validation.value),
            allParameterTypes = inputOutputHelper.getAllParameterTypes(bo);

        validationText += ' ' + translate('Consider change to type "' +
          (allParameterTypes[!inputOutputHelper.validateVariableExpression(value) ? 'variable' : 'expression'].label) +
          '".');

        validation.value = validationText;
        setCurrentValue(value);
      }

      return validation;
    }

  }));


  // parameter value (type = expression) ////////////////////////////////////////////////

  // we can't use a contenteditable here, because no change event got fired
  // cf. https://github.com/bpmn-io/bpmn-js-properties-panel/issues/351
  entries.push({
    id : idPrefix + 'parameterType-expression',
    html: '<div class="bpp-row">' +
    '<label for="' + idPrefix + 'parameterType-expression" data-show="isExpression">' + utils.escapeHTML(translate('Value')) + '</label>' +
    '<div class="bpp-field-wrapper" data-show="isExpression" data-shown="onShown">' +
      '<textarea ' +
        'rows="1"' +
        'id="camunda-' + idPrefix + 'parameterType-expression" ' +
        'type="text" ' +
        'name="value"></textarea>' +
    '</div>'+
  '</div>',
    get: function(element, node) {

      // set starting expression clauses as default placeholder
      var bo = getSelected(element, node),
          value = (bo || {}).value || EXPRESSION_CLAUSE_PLACEHOLDER;

      return {
        value: value
      };
    },

    set: function(element, values, node) {
      var bo = getSelected(element, node);

      values.value = values.value || undefined;

      return cmdHelper.updateBusinessObject(element, bo, values);
    },

    isExpression: function(element, node) {
      var bo = getSelected(element, node),
          parameterType = inputOutputHelper.getParameterType(bo, getCurrentType());

      return parameterType && parameterType.value === 'expression';
    },

    validate: function(element, values, node) {
      var bo = getSelected(element, node),
          value = values.value,
          currentType = getCurrentType();

      if (!value || currentType !== 'expression') {
        return;
      }

      clearCurrentValue();

      var validation = inputOutputHelper.validateExpression(value);

      if (validation) {
        var detectedType = validation.value;

        if (detectedType === 'constant-value') {
          validation.value = translate('Must contain expression clauses. Consider change to type "Constant Value".');
        } else {
          validation.value = translate('Value is identified as variable. Consider change to type "' +
          inputOutputHelper.getAllParameterTypes(bo)['variable'].label +
          '".');
        }

        setCurrentValue(value);
      }

      return validation;
    },

    onShown: function(element, entryNode) {
      var textAreaNode = domQuery('textarea', entryNode),
          value = textAreaNode.value;

      if (value === EXPRESSION_CLAUSE_PLACEHOLDER) {
        setCursorPosition(textAreaNode, 2);
      }
    }

  });


  // parameter value (type = script) ///////////////////////////////////////////////////////

  var script = scriptImplementation('scriptFormat', 'value', true, translate);
  entries.push({
    id: idPrefix + 'parameterType-script',
    html: '<div data-show="isScript">' +
            script.template +
          '</div>',
    get: function(element, node) {
      var bo = getSelected(element, node);
      return bo && isScript(bo.definition) ? script.get(element, bo.definition) : {};
    },

    set: function(element, values, node) {
      var bo = getSelected(element, node);
      var update = script.set(element, values);
      return cmdHelper.updateBusinessObject(element, bo.definition, update);
    },

    validate: function(element, values, node) {
      var bo = getSelected(element, node);
      return bo && isScript(bo.definition) ? script.validate(element, bo.definition) : {};
    },

    isScript: function(element, node) {
      var bo = getSelected(element, node);
      return bo && isScript(bo.definition);
    },

    script: script

  });


  // parameter value (type = list) ///////////////////////////////////////////////////////

  entries.push(entryFactory.table({
    id: idPrefix + 'parameterType-list',
    modelProperties: [ 'value' ],
    labels: [ translate('Value') ],
    addLabel: translate('Add Value'),

    getElements: function(element, node) {
      var bo = getSelected(element, node);

      if (bo && isList(bo.definition)) {
        return bo.definition.items;
      }

      return [];
    },

    updateElement: function(element, values, node, idx) {
      var bo = getSelected(element, node);
      var item = bo.definition.items[idx];
      return cmdHelper.updateBusinessObject(element, item, values);
    },

    addElement: function(element, node) {
      var bo = getSelected(element, node);
      var newValue = createElement('camunda:Value', bo.definition, bpmnFactory, { value: undefined });
      return cmdHelper.addElementsTolist(element, bo.definition, 'items', [ newValue ]);
    },

    removeElement: function(element, node, idx) {
      var bo = getSelected(element, node);
      return cmdHelper.removeElementsFromList(element, bo.definition, 'items', null, [ bo.definition.items[idx] ]);
    },

    editable: function(element, node, prop, idx) {
      var bo = getSelected(element, node);
      var item = bo.definition.items[idx];
      return !isMap(item) && !isList(item) && !isScript(item);
    },

    setControlValue: function(element, node, input, prop, value, idx) {
      var bo = getSelected(element, node);
      var item = bo.definition.items[idx];

      if (!isMap(item) && !isList(item) && !isScript(item)) {
        input.value = value;
      } else {
        input.value = typeInfo[item.$type].label;
      }
    },

    show: function(element, node) {
      var bo = getSelected(element, node);
      return bo && bo.definition && isList(bo.definition);
    }

  }));


  // parameter value (type = map) ///////////////////////////////////////////////////////

  entries.push(entryFactory.table({
    id: idPrefix + 'parameterType-map',
    modelProperties: [ 'key', 'value' ],
    labels: [ translate('Key'), translate('Value') ],
    addLabel: translate('Add Entry'),

    getElements: function(element, node) {
      var bo = getSelected(element, node);

      if (bo && isMap(bo.definition)) {
        return bo.definition.entries;
      }

      return [];
    },

    updateElement: function(element, values, node, idx) {
      var bo = getSelected(element, node);
      var entry = bo.definition.entries[idx];

      if (isMap(entry.definition) || isList(entry.definition) || isScript(entry.definition)) {
        values = {
          key: values.key
        };
      }

      return cmdHelper.updateBusinessObject(element, entry, values);
    },

    addElement: function(element, node) {
      var bo = getSelected(element, node);
      var newEntry = createElement('camunda:Entry', bo.definition, bpmnFactory, { key: undefined, value: undefined });
      return cmdHelper.addElementsTolist(element, bo.definition, 'entries', [ newEntry ]);
    },

    removeElement: function(element, node, idx) {
      var bo = getSelected(element, node);
      return cmdHelper.removeElementsFromList(element, bo.definition, 'entries', null, [ bo.definition.entries[idx] ]);
    },

    editable: function(element, node, prop, idx) {
      var bo = getSelected(element, node);
      var entry = bo.definition.entries[idx];
      return prop === 'key' || (!isMap(entry.definition) && !isList(entry.definition) && !isScript(entry.definition));
    },

    setControlValue: function(element, node, input, prop, value, idx) {
      var bo = getSelected(element, node);
      var entry = bo.definition.entries[idx];

      if (prop === 'key' || (!isMap(entry.definition) && !isList(entry.definition) && !isScript(entry.definition))) {
        input.value = value;
      } else {
        input.value = typeInfo[entry.definition.$type].label;
      }
    },

    show: function(element, node) {
      var bo = getSelected(element, node);
      return bo && bo.definition && isMap(bo.definition);
    }

  }));

  return entries;

};


// helpers /////////////////////

function createElement(type, parent, factory, properties) {
  return elementHelper.createElement(type, properties, parent, factory);
}

function isScript(elem) {
  return is(elem, 'camunda:Script');
}

function isList(elem) {
  return is(elem, 'camunda:List');
}

function isMap(elem) {
  return is(elem, 'camunda:Map');
}

function ensureInputOutputSupported(element, insideConnector) {
  return inputOutputHelper.isInputOutputSupported(element, insideConnector);
}

function isInputParameter(element) {
  return is(element, 'camunda:InputParameter');
}

function appendExpressionClauses(value) {
  return ''.concat('${', value, '}');
}

function removeExpressionClauses(expression) {
  return expression.substring(2, expression.length - 1);
}

function setCursorPosition(node, position) {
  node.focus();
  node.setSelectionRange(position, position);
}
