'use strict';

var ModelUtil = require('bpmn-js/lib/util/ModelUtil'),
    is = ModelUtil.is,
    getBusinessObject = ModelUtil.getBusinessObject;

var extensionElementsHelper = require('./ExtensionElementsHelper'),
    implementationTypeHelper = require('./ImplementationTypeHelper');

var InputOutputHelper = {};

module.exports = InputOutputHelper;

/**
 * Get a inputOutput from the business object
 *
 * @param {djs.model.Base} element
 * @param  {boolean} insideConnector
 *
 * @return {ModdleElement} the inputOutput object
 */
InputOutputHelper.getInputOutput = function(element, insideConnector) {
  if (!insideConnector) {
    var bo = getBusinessObject(element);
    return (getElements(bo, 'camunda:InputOutput') || [])[0];
  }
  var connector = this.getConnector(element);
  return connector && connector.get('inputOutput');
};

/**
 * Get a connector from the business object
 *
 * @param {djs.model.Base} element
 *
 * @return {ModdleElement} the connector object
 */
InputOutputHelper.getConnector = function(element) {
  var bo = implementationTypeHelper.getServiceTaskLikeBusinessObject(element);
  return bo && (getElements(bo, 'camunda:Connector') || [])[0];
};

/**
 * Return all input parameters existing in the business object, and
 * an empty array if none exist.
 *
 * @param  {djs.model.Base} element
 * @param  {boolean} insideConnector
 *
 * @return {Array} a list of input parameter objects
 */
InputOutputHelper.getInputParameters = function(element, insideConnector) {
  return getParameters.apply(this, [ element, 'inputParameters', insideConnector ]);
};

/**
 * Return all output parameters existing in the business object, and
 * an empty array if none exist.
 *
 * @param  {djs.model.Base} element
 * @param  {boolean} insideConnector
 *
 * @return {Array} a list of output parameter objects
 */
InputOutputHelper.getOutputParameters = function(element, insideConnector) {
  return getParameters.apply(this, [ element, 'outputParameters', insideConnector ]);
};

/**
 * Get a input parameter from the business object at given index
 *
 * @param {djs.model.Base} element
 * @param  {boolean} insideConnector
 * @param {number} idx
 *
 * @return {ModdleElement} input parameter
 */
InputOutputHelper.getInputParameter = function(element, insideConnector, idx) {
  return this.getInputParameters(element, insideConnector)[idx];
};

/**
 * Get a output parameter from the business object at given index
 *
 * @param {djs.model.Base} element
 * @param  {boolean} insideConnector
 * @param {number} idx
 *
 * @return {ModdleElement} output parameter
 */
InputOutputHelper.getOutputParameter = function(element, insideConnector, idx) {
  return this.getOutputParameters(element, insideConnector)[idx];
};

/**
 * Returns 'true' if the given element supports inputOutput
 *
 * @param {djs.model.Base} element
 * @param  {boolean} insideConnector
 *
 * @return {boolean} a boolean value
 */
InputOutputHelper.isInputOutputSupported = function(element, insideConnector) {

  if (insideConnector) {
    return true;
  }

  var bo = getBusinessObject(element);

  return (
    is(bo, 'bpmn:FlowNode') && !(
      is(bo, 'bpmn:StartEvent') ||
      is(bo, 'bpmn:Gateway') ||
      is(bo, 'bpmn:BoundaryEvent') ||
      (
        is(bo, 'bpmn:SubProcess') && bo.get('triggeredByEvent')
      )
    )
  );
};

/**
 * Returns 'true' if the given element supports output parameters
 *
 * @param {djs.model.Base} element
 * @param  {boolean} insideConnector
 *
 * @return {boolean} a boolean value
 */
InputOutputHelper.areOutputParametersSupported = function(element, insideConnector) {
  var bo = getBusinessObject(element);
  return insideConnector || (!is(bo, 'bpmn:EndEvent') && !bo.loopCharacteristics);
};

/**
 * Identifies whether a given parameter value is an expression by
 * checking expression clauses are inside ${}
 *
 * @param {string} value
 *
 * @return {boolean}
 */
InputOutputHelper.isExpression = function(value) {
  return /[A-z]*\$\{.*\}[A-z]*/.test(value);
};

/**
 * Validates whether paramater value is a valid constant value
 *
 * @param {string} value
 *
 * @return {Object|null} validation errors
 */
InputOutputHelper.validateConstantValue = function(value) {
  if (this.isExpression(value)) {
    return { value: 'Value must not contain expression clauses.' };
  }

  if (hasNewLines(value)) {
    return { value: 'Value must not contain new lines.' };
  }
};

/**
 * Validates whether paramater value is a variable expression
 *
 * @param {string} value
 *
 * @return {Object|null} validation errors
 */
InputOutputHelper.validateVariableExpression = function(value) {
  if (!startsWith(value, '${') && endsWith(value, '}')) {
    return { value: 'Value must contain single sorrounding expression clauses.' };
  }

  var expressionBody = getExpressionBody(value);

  if (!expressionBody) {
    return { value: 'Value must not be empty.' };
  }

  if (hasSpacesOrNewLines(expressionBody)) {
    return { value: 'Value must not contain spaces or new lines.' };
  }

  if (this.isExpression(expressionBody)) {
    return { value: 'Value must not contain multiple expression clauses.' };
  }

  if (hasFunction(expressionBody)) {
    return { value: 'Value must not contain function calls.' };
  }

  if (hasOperator(expressionBody)) {
    return { value: 'Value must not contain operators.' };
  }

  if (isLiteral(expressionBody)) {
    return { value: 'Value must not contain literals.' };
  }

  if (startsWithNumber(expressionBody)) {
    return { value: 'Value must not start with a number.' };
  }
};

InputOutputHelper.validateExpression = function(value) {
  if (!this.validateConstantValue(value)) {
    return { value: 'constant-value' };
  }

  if (!this.validateVariableExpression(value)) {
    return { value: 'variable' };
  }
};

/**
 * Retrieves list of all available parameter types, dependent on the parameters type
 *
 * @param {ModdleElement} bo - a valid input or output parameter
 *
 * @return {Object}
 */
InputOutputHelper.getAllParameterTypes = function(bo) {
  return {
    'variable': {
      value: 'variable',
      label: isInputParameter(bo) ? 'Process Variable' : 'Element Variable'
    },
    'constant-value': {
      value: 'constant-value',
      label: 'Constant Value'
    },
    'expression': {
      value: 'expression',
      label: 'Expression'
    },
    'camunda:Map': {
      value: 'map',
      label: 'Map'
    },
    'camunda:List': {
      value: 'list',
      label: 'List'
    },
    'camunda:Script': {
      value: 'script',
      label: 'Script'
    }
  };
};



/**
 * Returns correct parameter type definition for given business object
 *
 * @param {ModdleElement} bo
 *
 * @return {Object}
 */
InputOutputHelper.getParameterType = function(bo) {

  var parameterTypes = this.getAllParameterTypes(bo);

  if (typeof bo === 'undefined' || !(isInputOutputParameter(bo))) {
    return {};
  }

  var definition = bo.get('definition'),
      value = bo.get('value');

  // (1) handle non-expression types (scripts, lists and maps)
  if (typeof definition !== 'undefined') {
    return parameterTypes[definition.$type];
  }

  // (2) set <variable> as default for null values, or force type
  if (!value) {
    var lastType = bo.$lastType;
    return parameterTypes[lastType || 'variable'];
  }

  // (3) validate whether value is <constant-value>
  if (!this.validateConstantValue(value)) {
    return parameterTypes['constant-value'];
  }

  // (4) validate whether value is <variable>
  if (!this.validateVariableExpression(value)) {
    return parameterTypes['variable'];
  }

  return parameterTypes['expression'];
};


// helpers //////////////////////////////

function getElements(bo, type, prop) {
  var elems = extensionElementsHelper.getExtensionElements(bo, type) || [];
  return !prop ? elems : (elems[0] || {})[prop] || [];
}

function getParameters(element, prop, insideConnector) {
  var inputOutput = InputOutputHelper.getInputOutput(element, insideConnector);
  return (inputOutput && inputOutput.get(prop)) || [];
}

function hasFunction(expression) {
  return /[A-z]*\(.*\)[A-z]*/.test(expression);
}

function hasOperator(expression) {
  return /(\+|-|\.|\*|\/|=|>|<|>=|<=|&|\||%|!|\^|\(|\))/.test(expression);
}

function getExpressionBody(expression) {
  return expression.substring(2, expression.length - 1);
}

function startsWithNumber(expression) {
  return /^[0-9]/.test(expression);
}

function hasSpacesOrNewLines(string) {
  return hasSpaces(string) || hasNewLines(string);
}

function hasNewLines(string) {
  return /[\n\r]+/.test(string);
}

function hasSpaces(string) {
  return /[\s]+/.test(string);
}

function isLiteral(string) {
  return /^(true|false|null)$/.test(string);
}

function isInputParameter(element) {
  return is(element, 'camunda:InputParameter');
}

function isInputOutputParameter(element) {
  return is(element, 'camunda:InputOutputParameter');
}

function startsWith(string, match) {
  return string.indexOf(match) === 0;
}

function endsWith(string, match) {
  return string.indexOf(match, string.length - match.length) !== -1;
}
