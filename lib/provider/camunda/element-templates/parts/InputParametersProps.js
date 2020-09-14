'use strict';

var filter = require('min-dash').filter,
    forEach = require('min-dash').forEach;

var entryFactory = require('../../../../factory/EntryFactory'),
    getBusinessObject = require('bpmn-js/lib/util/ModelUtil').getBusinessObject,
    getTemplate = require('../Helper').getTemplate,
    cmdHelper = require('../../../../helper/CmdHelper'),
    elementHelper = require('../../../../helper/ElementHelper');

var collapsibleEntry = require('../../../../factory/CollapsibleEntryFactory');

var findExtension = require('../Helper').findExtension,
    findInputParameter = require('../Helper').findInputParameter;

var createInputParameter = require('../CreateHelper').createInputParameter;

var CAMUNDA_INPUT_PARAMETER_TYPE = 'camunda:inputParameter';

var INPUT_OUTPUT_DEFAULT_TYPE = 'IODefault';

/**
 * Injects element template input parameters into the given group.
 *
 * @param {djs.model.Base} element
 * @param {ElementTemplates} elementTemplates
 * @param {BpmnFactory} bpmnFactory
 * @param {Function} translate
 */
module.exports = function(group, element, elementTemplates, bpmnFactory, translate) {

  var template = getTemplate(element, elementTemplates);

  if (!template) {
    return [];
  }

  var renderInputParameter = function(id, p) {

    var entries = [];

    // header ////////////////
    // todo(pinussilvestrus): use label and not name?
    var collapsible = collapsibleEntry({
      id: id + '-collapsible',
      title: p.binding.name || translate(p.label),
      open: true
    });
    entries.push(collapsible);

    var isOpen = collapsible.isOpen;

    // todo(pinussilvestrus): handle onToggle!


    // details //////////////

    // todo(pinussilvestrus): render new collapsible card component
    entries.push(entryFactory.textBox({
      id: id + '-parameter-value',
      label: translate('Assignment Value'),
      description: translate('Start typing "${}" to create an expression.'),
      modelProperty: id,
      get: propertyGetter(id, p),
      set: propertySetter(id, p, bpmnFactory),
      validate: propertyValidator(id, p, translate),
      hidden: function(element, node) {
        // return !isOpen();
        return false;
      }
    }));

    return entries;
  };

  var entries = [];
  var id, inputEntries;

  // filter specific input parameters from template
  var inputParameters = filter(template.properties, function(p) {
    return p.binding.type === CAMUNDA_INPUT_PARAMETER_TYPE && p.type === INPUT_OUTPUT_DEFAULT_TYPE;
  });

  forEach(inputParameters, function(property, idx) {

    id = 'template-inputs-' + template.id + '-' + idx;

    inputEntries = renderInputParameter(id, property);
    if (inputEntries) {
      entries = entries.concat(inputEntries);
    }
  });

  group.entries = group.entries.concat(entries);
};


// getters, setters and validators ///////////////


/**
 * Return a getter that retrieves the given property.
 *
 * @param {String} name
 * @param {PropertyDescriptor} property
 *
 * @return {Function}
 */
function propertyGetter(name, property) {

  /* getter */
  return function get(element) {
    var value = getPropertyValue(element, property);

    return objectWithKey(name, value);
  };
}

/**
 * Return a setter that updates the given property.
 *
 * @param {String} name
 * @param {PropertyDescriptor} property
 * @param {BpmnFactory} bpmnFactory
 *
 * @return {Function}
 */
function propertySetter(name, property, bpmnFactory) {

  /* setter */
  return function set(element, values) {

    var value = values[name];

    return setPropertyValue(element, property, value, bpmnFactory);
  };
}

/**
 * Return a validator that ensures the property is ok.
 *
 * @param {String} name
 * @param {PropertyDescriptor} property
 * @param {Function} translate
 *
 * @return {Function}
 */
function propertyValidator(name, property, translate) {

  /* validator */
  return function validate(element, values) {
    var value = values[name];

    var error = validateValue(value, property, translate);

    if (error) {
      return objectWithKey(name, error);
    }
  };
}


// get, set and validate helpers ///////////////////

/**
 * Return the value of the specified property descriptor,
 * on the passed diagram element.
 *
 * @param {djs.model.Base} element
 * @param {PropertyDescriptor} property
 *
 * @return {Any}
 */
function getPropertyValue(element, property) {

  var bo = getBusinessObject(element);

  var binding = property.binding,
      bindingType = binding.type;

  var propertyValue = property.value || '';

  // property

  var inputOutput,
      inputParameter;

  if (bindingType === CAMUNDA_INPUT_PARAMETER_TYPE) {

    inputOutput = findExtension(bo, 'camunda:InputOutput');

    if (!inputOutput) {
      // ioParameter cannot exist yet, return property value
      return propertyValue;
    }

    inputParameter = findInputParameter(inputOutput, binding);

    if (inputParameter) {
      if (binding.scriptFormat) {
        if (inputParameter.definition) {
          return inputParameter.definition.value;
        }
      } else {
        return inputParameter.value || '';
      }
    }

    return propertyValue;
  }

  throw unknownPropertyBinding(property);
}

module.exports.getPropertyValue = getPropertyValue;


/**
 * Return an update operation that changes the diagram
 * element's custom property to the given value.
 *
 * The response of this method will be processed via
 * {@link PropertiesPanel#applyChanges}.
 *
 * @param {djs.model.Base} element
 * @param {PropertyDescriptor} property
 * @param {String} value
 * @param {BpmnFactory} bpmnFactory
 *
 * @return {Object|Array<Object>} results to be processed
 */
function setPropertyValue(element, property, value, bpmnFactory) {
  var bo = getBusinessObject(element);

  var binding = property.binding,
      bindingType = binding.type;

  var updates = [];

  var extensionElements;

  if (bindingType === CAMUNDA_INPUT_PARAMETER_TYPE) {
    extensionElements = bo.get('extensionElements');

    // create extension elements, if they do not exist (yet)
    if (!extensionElements) {
      extensionElements = elementHelper.createElement('bpmn:ExtensionElements', null, element, bpmnFactory);

      updates.push(cmdHelper.updateBusinessObject(
        element, bo, objectWithKey('extensionElements', extensionElements)
      ));
    }

    var inputOutput = findExtension(extensionElements, 'camunda:InputOutput');

    // create inputOutput element, if it do not exist (yet)
    if (!inputOutput) {
      inputOutput = elementHelper.createElement('camunda:InputOutput', null, bo, bpmnFactory);

      updates.push(cmdHelper.addElementsTolist(
        element, extensionElements, 'values', inputOutput
      ));
    }

    var existingInputParameter = findInputParameter(inputOutput, binding);

    var newInputParameter = createInputParameter(binding, value, bpmnFactory);

    updates.push(cmdHelper.addAndRemoveElementsFromList(
      element,
      inputOutput,
      'inputParameters',
      null,
      [ newInputParameter ],
      existingInputParameter ? [ existingInputParameter ] : []
    ));
  }

  if (updates.length) {
    return updates;
  }

  // quick warning for better debugging
  console.warn('no update', element, property, value);
}

module.exports.setPropertyValue = setPropertyValue;

/**
 * Validate value of a given property.
 *
 * @param {String} value
 * @param {PropertyDescriptor} property
 * @param {Function} translate
 *
 * @return {Object} with validation errors
 */
function validateValue(value, property, translate) {

  var constraints = property.constraints || {};

  if (constraints.notEmpty && isEmpty(value)) {
    return translate('Must not be empty');
  }

  if (constraints.maxLength && value.length > constraints.maxLength) {
    return translate('Must have max length {length}', { length: constraints.maxLength });
  }

  if (constraints.minLength && value.length < constraints.minLength) {
    return translate('Must have min length {length}', { length: constraints.minLength });
  }

  var pattern = constraints.pattern,
      message;

  if (pattern) {

    if (typeof pattern !== 'string') {
      message = pattern.message;
      pattern = pattern.value;
    }

    if (!matchesPattern(value, pattern)) {
      return message || translate('Must match pattern {pattern}', { pattern: pattern });
    }
  }
}


// helpers ///////////////////////////////

/**
 * Return an object with a single key -> value association.
 *
 * @param {String} key
 * @param {Any} value
 *
 * @return {Object}
 */
function objectWithKey(key, value) {
  var obj = {};

  obj[key] = value;

  return obj;
}

/**
 * Does the given string match the specified pattern?
 *
 * @param {String} str
 * @param {String} pattern
 *
 * @return {Boolean}
 */
function matchesPattern(str, pattern) {
  var regexp = new RegExp(pattern);

  return regexp.test(str);
}

function isEmpty(str) {
  return !str || /^\s*$/.test(str);
}

/**
 * Create a new {@link Error} indicating an unknown
 * property binding.
 *
 * @param {PropertyDescriptor} property
 *
 * @return {Error}
 */
function unknownPropertyBinding(property) {
  var binding = property.binding;

  return new Error('unknown binding: <' + binding.type + '>');
}
