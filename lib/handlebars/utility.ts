import { z } from "zod";

export function makeZodHelper<
  T extends [] | [z.ZodTypeAny, ...z.ZodTypeAny[]],
>(
  ...argumentSchemas: T
): z.infer<
  z.ZodFunction<
    z.ZodTuple<[
      z.ZodFunction<
        z.ZodTuple<T>,
        z.ZodUnknown
      >,
    ], null>,
    z.ZodTypeAny
  >
> {
  const schema = z.tuple(argumentSchemas);
  return (helperFn) => {
    return (...args: unknown[]) => {
      const helperArgs = args.slice(0, -1);
      if (helperArgs.length < argumentSchemas.length) {
        helperArgs.push(
          ...Array.from({ length: argumentSchemas.length - helperArgs.length }),
        );
      }
      return helperFn(...schema.parse(helperArgs));
    };
  };
}
