// 该库的 package.json exports 没有声明类型入口；它与 better-sqlite3 API 一致，直接复用其类型
declare module 'better-sqlite3-multiple-ciphers' {
  import Database from 'better-sqlite3';
  export = Database;
}
