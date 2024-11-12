export type Result<T, E> = ResultOk<T, E> | ResultErr<E>;

export interface ResultOk<T, _E> {
  value: T;
  error: undefined;
}

export interface ResultErr<E> {
  value: undefined;
  error: E;
}
