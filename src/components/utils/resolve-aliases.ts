/**
 * Resolves aliases in specified object according to passed aliases info
 *
 * @example resolveAliases(obj, { label: 'title' })
 * here 'label' is alias for 'title'
 * @param obj - object with aliases to be resolved
 * @param aliases - object with aliases info where key is an alias property name and value is an aliased property name
 */
export const resolveAliases = <ObjectType extends object>(
  obj: ObjectType,
  aliases: Partial<Record<string, keyof ObjectType>>
): ObjectType => {
  const result = {} as ObjectType;

  (Object.keys(obj) as Array<keyof ObjectType | string>).forEach((property) => {
    const propertyKey = property as keyof ObjectType;
    const propertyString = String(property);
    const aliasedProperty = aliases[propertyString];

    if (aliasedProperty === undefined) {
      result[propertyKey] = obj[propertyKey];

      return;
    }

    if (!(aliasedProperty in obj)) {
      result[aliasedProperty] = obj[propertyKey];
    }
  });

  return result;
};
