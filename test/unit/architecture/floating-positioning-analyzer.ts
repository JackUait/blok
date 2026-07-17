import ts from 'typescript';

export type FloatingEvidenceKind =
  | 'root-mount'
  | 'root-geometry-read'
  | 'geometry-read'
  | 'coordinate-write'
  | 'fixed-position-signal'
  | 'top-layer-signal'
  | 'shared-position-call'
  | 'position-tracker-call'
  | 'popover-desktop-construction'
  | 'tracked-virtual-position'
  | 'dismissible-virtual-position'
  | 'unclassified-virtual-position'
  | 'dynamic-root-style-access';

export interface FloatingEvidence {
  kind: FloatingEvidenceKind;
  line: number;
  column: number;
  detail: string;
}

const ROOT_PROPERTIES = new Set(['body', 'documentElement']);
const MOUNT_METHODS = new Set(['append', 'appendChild', 'prepend', 'insertBefore']);
const COORDINATE_PROPERTIES = new Set(['top', 'left']);
const SHARED_POSITION_CALLS = new Set([
  'positionAnchored',
  'positionFixedAnchored',
  'resolveBoundaryRect',
  'resolvePosition',
]);

type FunctionLikeWithBody =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration;

interface MemberAccess {
  receiver: ts.Expression;
  name?: string;
  dynamic: boolean;
}

const unwrapExpression = (expression: ts.Expression): ts.Expression => {
  if (
    ts.isParenthesizedExpression(expression)
    || ts.isAsExpression(expression)
    || ts.isTypeAssertionExpression(expression)
    || ts.isNonNullExpression(expression)
    || ts.isSatisfiesExpression(expression)
    || ts.isPartiallyEmittedExpression(expression)
  ) {
    return unwrapExpression(expression.expression);
  }

  return expression;
};

const literalText = (node: ts.Node | undefined): string | undefined => {
  if (node === undefined) {
    return undefined;
  }

  if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) {
    return node.text;
  }

  return undefined;
};

const propertyNameText = (name: ts.PropertyName | ts.BindingName | undefined): string | undefined => {
  if (name === undefined) {
    return undefined;
  }

  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  if (ts.isComputedPropertyName(name)) {
    return literalText(unwrapExpression(name.expression));
  }

  return undefined;
};

const memberAccess = (expression: ts.Expression): MemberAccess | undefined => {
  const unwrapped = unwrapExpression(expression);

  if (ts.isPropertyAccessExpression(unwrapped)) {
    return {
      receiver: unwrapped.expression,
      name: unwrapped.name.text,
      dynamic: false,
    };
  }

  if (ts.isElementAccessExpression(unwrapped)) {
    const name = literalText(unwrapped.argumentExpression === undefined
      ? undefined
      : unwrapExpression(unwrapped.argumentExpression));

    return {
      receiver: unwrapped.expression,
      name,
      dynamic: name === undefined,
    };
  }

  return undefined;
};

const identifierText = (expression: ts.Expression): string | undefined => {
  const unwrapped = unwrapExpression(expression);

  return ts.isIdentifier(unwrapped) ? unwrapped.text : undefined;
};

const stringContainsCoordinates = (value: string): boolean =>
  /(?:^|[;{\s])(?:top|left)\s*:/iu.test(value);

const stringContainsFixedPosition = (value: string): boolean =>
  /(?:^|[;{\s])position\s*:\s*fixed(?:\s|;|$)/iu.test(value);

const collectNodes = (root: ts.Node): ts.Node[] => {
  const nodes: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    nodes.push(node);
    ts.forEachChild(node, visit);
  };

  visit(root);

  return nodes;
};

const addName = (names: Set<string>, name: string | undefined): boolean => {
  if (name === undefined || names.has(name)) {
    return false;
  }

  names.add(name);

  return true;
};

const functionName = (node: FunctionLikeWithBody): string | undefined => {
  if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name !== undefined) {
    return propertyNameText(node.name);
  }

  if (
    (ts.isFunctionExpression(node) || ts.isArrowFunction(node))
    && ts.isVariableDeclaration(node.parent)
    && ts.isIdentifier(node.parent.name)
  ) {
    return node.parent.name.text;
  }

  return undefined;
};

const isFunctionLikeWithBody = (node: ts.Node): node is FunctionLikeWithBody =>
  (ts.isFunctionDeclaration(node)
    || ts.isFunctionExpression(node)
    || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node))
  && node.body !== undefined;

const callTargetName = (expression: ts.Expression): string | undefined => {
  const directName = identifierText(expression);

  return directName ?? memberAccess(expression)?.name;
};

/**
 * Parse one production source file and return syntax evidence relevant to the
 * floating-positioning architecture law.
 */
export const analyzeFloatingSource = (
  source: string,
  fileName = 'fixture.ts'
): FloatingEvidence[] => {
  const scriptKind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind
  );
  const nodes = collectNodes(sourceFile);
  const documentAliases = new Set(['document']);
  const rootAliases = new Set<string>();
  const styleAliases = new Set<string>();

  const isDocumentExpression = (expression: ts.Expression): boolean => {
    const unwrapped = unwrapExpression(expression);
    const name = identifierText(unwrapped);

    if (name !== undefined && documentAliases.has(name)) {
      return true;
    }

    const access = memberAccess(unwrapped);
    const receiverName = access === undefined ? undefined : identifierText(access.receiver);

    return access?.name === 'document'
      && (receiverName === 'window' || receiverName === 'globalThis');
  };

  const isRootExpression = (expression: ts.Expression): boolean => {
    const unwrapped = unwrapExpression(expression);
    const name = identifierText(unwrapped);

    if (name !== undefined && rootAliases.has(name)) {
      return true;
    }

    const access = memberAccess(unwrapped);

    return access?.name !== undefined
      && ROOT_PROPERTIES.has(access.name)
      && isDocumentExpression(access.receiver);
  };

  const isStyleExpression = (expression: ts.Expression): boolean => {
    const unwrapped = unwrapExpression(expression);
    const name = identifierText(unwrapped);

    if (name !== undefined && styleAliases.has(name)) {
      return true;
    }

    return memberAccess(unwrapped)?.name === 'style';
  };

  const collectBindingAliases = (
    name: ts.BindingName,
    initializer: ts.Expression
  ): boolean => {
    if (ts.isIdentifier(name)) {
      return (
        (isDocumentExpression(initializer) && addName(documentAliases, name.text))
        || (isRootExpression(initializer) && addName(rootAliases, name.text))
        || (isStyleExpression(initializer) && addName(styleAliases, name.text))
      );
    }

    if (!ts.isObjectBindingPattern(name)) {
      return false;
    }

    return name.elements.reduce((changed, element) => {
      if (!ts.isIdentifier(element.name)) {
        return changed;
      }

      const property = propertyNameText(element.propertyName ?? element.name);

      if (
        property !== undefined
        && ROOT_PROPERTIES.has(property)
        && isDocumentExpression(initializer)
      ) {
        return addName(rootAliases, element.name.text) || changed;
      }

      if (property === 'style') {
        return addName(styleAliases, element.name.text) || changed;
      }

      return changed;
    }, false);
  };

  /**
   * Alias collection is deliberately conservative and flow-insensitive. If a
   * name ever aliases a root or style object in one source file, later dynamic
   * use remains reviewable even if the value is reassigned.
   */
  for (let changed = true; changed;) {
    changed = false;

    nodes.forEach((node) => {
      if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
        changed = collectBindingAliases(node.name, node.initializer) || changed;

        return;
      }

      if (
        ts.isBinaryExpression(node)
        && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && ts.isIdentifier(unwrapExpression(node.left))
      ) {
        const name = identifierText(node.left);

        if (name === undefined) {
          return;
        }

        changed = (
          (isDocumentExpression(node.right) && addName(documentAliases, name))
          || (isRootExpression(node.right) && addName(rootAliases, name))
          || (isStyleExpression(node.right) && addName(styleAliases, name))
          || changed
        );
      }
    });
  }

  /**
   * Summarize local helpers such as append(target, node) before inspecting
   * calls that pass document.body through them.
   */
  const mountHelperParams = new Map<string, Set<number>>();

  nodes.filter(isFunctionLikeWithBody).forEach((node) => {
    const name = functionName(node);
    const body = node.body;

    if (name === undefined || body === undefined) {
      return;
    }

    const parameterAliases = node.parameters.map((parameter) => {
      const parameterName = ts.isIdentifier(parameter.name) ? parameter.name.text : undefined;

      return parameterName === undefined ? new Set<string>() : new Set([parameterName]);
    });
    const functionNodes = collectNodes(body);

    for (let changed = true; changed;) {
      changed = false;

      functionNodes.forEach((functionNode) => {
        if (
          !ts.isVariableDeclaration(functionNode)
          || functionNode.initializer === undefined
          || !ts.isIdentifier(functionNode.name)
        ) {
          return;
        }

        const initializerName = identifierText(functionNode.initializer);
        const aliasName = propertyNameText(functionNode.name);

        if (aliasName === undefined) {
          return;
        }

        parameterAliases.forEach((aliases) => {
          if (initializerName !== undefined && aliases.has(initializerName)) {
            changed = addName(aliases, aliasName) || changed;
          }
        });
      });
    }

    functionNodes.forEach((functionNode) => {
      if (!ts.isCallExpression(functionNode)) {
        return;
      }

      const access = memberAccess(functionNode.expression);
      const receiverName = access === undefined ? undefined : identifierText(access.receiver);

      if (
        access?.name === undefined
        || !MOUNT_METHODS.has(access.name)
        || receiverName === undefined
      ) {
        return;
      }

      parameterAliases.forEach((aliases, index) => {
        if (!aliases.has(receiverName)) {
          return;
        }

        const indexes = mountHelperParams.get(name) ?? new Set<number>();

        indexes.add(index);
        mountHelperParams.set(name, indexes);
      });
    });
  });

  const evidence: FloatingEvidence[] = [];
  const evidenceKeys = new Set<string>();

  const addEvidence = (
    kind: FloatingEvidenceKind,
    node: ts.Node,
    detail: string
  ): void => {
    const position = node.getStart(sourceFile);
    const key = `${kind}:${position}`;

    if (evidenceKeys.has(key)) {
      return;
    }

    evidenceKeys.add(key);

    const location = sourceFile.getLineAndCharacterOfPosition(position);

    evidence.push({
      kind,
      line: location.line + 1,
      column: location.character + 1,
      detail,
    });
  };

  const addStyleTextEvidence = (node: ts.Node, value: string): void => {
    if (stringContainsCoordinates(value)) {
      addEvidence('coordinate-write', node, 'style text writes top/left coordinates');
    }

    if (stringContainsFixedPosition(value)) {
      addEvidence('fixed-position-signal', node, 'style text selects fixed positioning');
    }
  };

  const inspectObjectLiteralStyle = (
    object: ts.ObjectLiteralExpression,
    owner: ts.Node
  ): void => {
    object.properties.forEach((property) => {
      if (ts.isSpreadAssignment(property)) {
        return;
      }

      const name = propertyNameText(property.name);

      if (name === undefined && ts.isComputedPropertyName(property.name)) {
        addEvidence(
          'dynamic-root-style-access',
          property,
          'Object.assign uses a dynamic style property'
        );

        return;
      }

      if (name !== undefined && COORDINATE_PROPERTIES.has(name)) {
        addEvidence('coordinate-write', owner, `Object.assign writes style.${name}`);
      }

      if (
        name === 'position'
        && ts.isPropertyAssignment(property)
        && literalText(unwrapExpression(property.initializer)) === 'fixed'
      ) {
        addEvidence('fixed-position-signal', owner, 'Object.assign selects fixed positioning');
      }
    });
  };

  const inspectStyleAssignment = (node: ts.BinaryExpression): void => {
    const access = memberAccess(node.left);

    if (access === undefined || !isStyleExpression(access.receiver)) {
      return;
    }

    if (access.dynamic) {
      addEvidence(
        'dynamic-root-style-access',
        node,
        'dynamic assignment through a style alias'
      );

      return;
    }

    if (access.name !== undefined && COORDINATE_PROPERTIES.has(access.name)) {
      addEvidence('coordinate-write', node, `writes style.${access.name}`);

      return;
    }

    if (access.name === 'cssText') {
      addEvidence('coordinate-write', node, 'cssText can replace top/left coordinates');

      const value = literalText(unwrapExpression(node.right));

      if (value !== undefined) {
        addStyleTextEvidence(node, value);
      } else {
        addEvidence(
          'dynamic-root-style-access',
          node,
          'cssText is assigned from a dynamic value'
        );
      }

      return;
    }

    if (
      access.name === 'position'
      && literalText(unwrapExpression(node.right)) === 'fixed'
    ) {
      addEvidence('fixed-position-signal', node, 'style.position is fixed');
    }
  };

  const inspectSetPropertyCall = (
    node: ts.CallExpression,
    access: MemberAccess
  ): void => {
    if (access.name !== 'setProperty' || !isStyleExpression(access.receiver)) {
      return;
    }

    const property = literalText(node.arguments[0] === undefined
      ? undefined
      : unwrapExpression(node.arguments[0]));

    if (property !== undefined && COORDINATE_PROPERTIES.has(property)) {
      addEvidence('coordinate-write', node, `setProperty writes ${property}`);
    } else if (property === undefined) {
      addEvidence(
        'dynamic-root-style-access',
        node,
        'setProperty uses a dynamic style property'
      );
    }

    if (
      property === 'position'
      && literalText(node.arguments[1] === undefined
        ? undefined
        : unwrapExpression(node.arguments[1])) === 'fixed'
    ) {
      addEvidence('fixed-position-signal', node, 'setProperty selects fixed positioning');
    }
  };

  const inspectSetAttributeCall = (
    node: ts.CallExpression,
    access: MemberAccess
  ): void => {
    if (access.name !== 'setAttribute') {
      return;
    }

    const attribute = literalText(node.arguments[0] === undefined
      ? undefined
      : unwrapExpression(node.arguments[0]));

    if (attribute !== 'style') {
      return;
    }

    const value = literalText(node.arguments[1] === undefined
      ? undefined
      : unwrapExpression(node.arguments[1]));

    if (value === undefined) {
      addEvidence(
        'dynamic-root-style-access',
        node,
        'style attribute is assigned from a dynamic value'
      );

      return;
    }

    addStyleTextEvidence(node, value);
  };

  const inspectObjectAssignCall = (
    node: ts.CallExpression,
    access: MemberAccess
  ): void => {
    if (
      access.name !== 'assign'
      || identifierText(access.receiver) !== 'Object'
      || node.arguments[0] === undefined
      || !isStyleExpression(node.arguments[0])
    ) {
      return;
    }

    node.arguments.slice(1)
      .map(unwrapExpression)
      .filter(ts.isObjectLiteralExpression)
      .forEach((object) => inspectObjectLiteralStyle(object, node));
  };

  const inspectMemberCall = (
    node: ts.CallExpression,
    access: MemberAccess
  ): void => {
    if (access.dynamic && (isRootExpression(access.receiver) || isStyleExpression(access.receiver))) {
      addEvidence(
        'dynamic-root-style-access',
        node,
        'dynamic call through a known root/style alias'
      );
    }

    if (
      access.name !== undefined
      && MOUNT_METHODS.has(access.name)
      && isRootExpression(access.receiver)
    ) {
      addEvidence('root-mount', node, `calls root.${access.name}()`);
    }

    if (access.name === 'getBoundingClientRect') {
      addEvidence('geometry-read', node, 'calls getBoundingClientRect()');

      if (isRootExpression(access.receiver)) {
        addEvidence(
          'root-geometry-read',
          node,
          'reads the CSS box of document.body/documentElement'
        );
      }
    }

    inspectSetPropertyCall(node, access);
    inspectSetAttributeCall(node, access);
    inspectObjectAssignCall(node, access);
  };

  const inspectMountHelperCall = (
    node: ts.CallExpression,
    name: string | undefined
  ): void => {
    if (name === undefined) {
      return;
    }

    mountHelperParams.get(name)?.forEach((index) => {
      const argument = node.arguments[index];

      if (argument !== undefined && isRootExpression(argument)) {
        addEvidence(
          'root-mount',
          node,
          `passes a document root to mount helper ${name}()`
        );
      }
    });
  };

  const inspectCall = (node: ts.CallExpression): void => {
    const name = callTargetName(node.expression);
    const access = memberAccess(node.expression);

    if (access !== undefined) {
      inspectMemberCall(node, access);
    }

    if (name !== undefined && SHARED_POSITION_CALLS.has(name)) {
      addEvidence('shared-position-call', node, `calls ${name}()`);
    }

    if (name === 'createPositionTracker') {
      addEvidence('position-tracker-call', node, 'creates a position tracker');
    }

    if (name === 'promoteToTopLayer') {
      addEvidence('top-layer-signal', node, 'promotes an element to the CSS top layer');
    }

    inspectMountHelperCall(node, name);
  };

  nodes.forEach((node) => {
    if (ts.isElementAccessExpression(node)) {
      const access = memberAccess(node);

      if (
        access?.dynamic === true
        && (isRootExpression(access.receiver) || isStyleExpression(access.receiver))
      ) {
        addEvidence(
          'dynamic-root-style-access',
          node,
          'dynamic property access on a known root/style alias'
        );
      }
    }

    if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
      && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      inspectStyleAssignment(node);
    }

    if (ts.isCallExpression(node)) {
      inspectCall(node);
    }

    if (!ts.isNewExpression(node) || callTargetName(node.expression) !== 'PopoverDesktop') {
      return;
    }

    addEvidence(
      'popover-desktop-construction',
      node,
      'constructs a PopoverDesktop surface'
    );

    const firstArgument = node.arguments?.[0];
    const params = firstArgument === undefined ? undefined : unwrapExpression(firstArgument);

    if (params === undefined || !ts.isObjectLiteralExpression(params)) {
      return;
    }

    const properties = new Map<string, ts.ObjectLiteralElementLike>();

    params.properties.forEach((property) => {
      if (!ts.isSpreadAssignment(property)) {
        const name = propertyNameText(property.name);

        if (name !== undefined) {
          properties.set(name, property);
        }
      }
    });

    if (!properties.has('position')) {
      return;
    }

    if (properties.has('positionContext')) {
      addEvidence(
        'tracked-virtual-position',
        node,
        'virtual position declares a live positionContext'
      );

      return;
    }

    const lifecycle = properties.get('positionLifecycle');
    const lifecycleValue = lifecycle !== undefined && ts.isPropertyAssignment(lifecycle)
      ? literalText(unwrapExpression(lifecycle.initializer))
      : undefined;

    if (lifecycleValue === 'dismiss-on-nested-scroll') {
      addEvidence(
        'dismissible-virtual-position',
        node,
        'virtual position explicitly dismisses on nested scroll'
      );

      return;
    }

    addEvidence(
      'unclassified-virtual-position',
      node,
      'virtual position omits a live context and dismissal policy'
    );
  });

  return evidence.sort((left, right) =>
    left.line - right.line
    || left.column - right.column
    || left.kind.localeCompare(right.kind));
};
