/**
 * Resolves aliases in specified object according to passed aliases info
 *
 * @example resolveAliases(obj, { label: 'title' })
 * here 'label' is alias for 'title'
 * @param obj - object with aliases to be resolved
 * @param aliases - object with aliases info where key is an alias property name and value is an aliased property name
 */
export const resolveAliases = <ObjectType extends Record<string, unknown>>(
  obj: ObjectType,
  aliases: { [alias: string]: string }
): ObjectType => {
  const result = {} as ObjectType;

  Object.keys(obj).forEach(property => {
    const aliasedProperty = aliases[property];

    if (aliasedProperty !== undefined) {
      result[aliasedProperty as keyof ObjectType] = obj[property as keyof ObjectType];
    } else {
      result[property as keyof ObjectType] = obj[property as keyof ObjectType];
    }
  });

  return result;
};
