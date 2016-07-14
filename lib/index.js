import Rx from 'rx';
import { createHistory } from 'history';
import UrlPattern from 'url-pattern';
import qs from 'qs';

const joinPattern = (prefix, pattern) => {
  const partPattern = /\/?([^\/]*)\/?/;
  const prefixParts = [].slice.call(prefix.match(partPattern), 1);
  const patternParts = [].slice.call(pattern.match(partPattern), 1);
  const joinedPattern = [...prefixParts, ...patternParts].join('/');
  return joinedPattern
    // add leading slash
    .replace(/(^[^\/].+)/, '/$1')
    // remove trailing slash
    .replace(/([^\/]+)\/$/, '$1');
};

const createRouteObservable = (
  pattern,
  opts,
  history,
  historyObservable,
  subRouter
) => {
  const finalPattern = subRouter ? new RegExp(pattern + '.*') : pattern;
  const patternMatcher = new UrlPattern(finalPattern);
  let routeObservable = historyObservable
      .map(location => ({
      params: patternMatcher.match(location.pathname),
      query: qs.parse(location.search.substring(1)),
      state: location.state
    }))
    .scan((oldRoute, newRoute) => {
      if(
        typeof opts.onExit !== null &&
        oldRoute !== null &&
        oldRoute.params !== null &&
        newRoute.prams === null
      ) {
        opts.onExit(oldRoute, newRoute, history)
      }
      return newRoute;
    })
    .filter(route => route.params !== null);
  if (subRouter) {
    routeObservable = Rx.Observable.combineLatest(
      routeObservable,
      subRouter.asObservable()
    );
  } else {
    // We wrap the route in an array to maintain a consistent
    // API in the case where there is a subRouter
    routeObservable = routeObservable.map(route => [route]);
  }
  if (typeof opts.onNext === 'function') {
    routeObservable = routeObservable.flatMapLatest(([route, children]) => {
      const ret = opts.onNext(route, history);
      if (ret instanceof Promise) {
        return ret.then(() => [route, children]);
      } else {
        return Promise.resolve([route, children]);
      }
    });
  }
  if (typeof opts.stream === 'function') {
    routeObservable = routeObservable.flatMapLatest(([route, children]) => {
      return opts.stream(route, history, children);
    });
  } else if (subRouter) {
    routeObservable = routeObservable.map(([route, children]) => children);
  } else {
    routeObservable = routeObservable.map(([route, children]) => route);
  }

  return routeObservable;
}

const createRouterObservable = (history, prefix='') => {
  const historySubject = new Rx.BehaviorSubject(history.getCurrentLocation());
  const routeSubject = new Rx.ReplaySubject();
  let subRouters = [];

  history.listen((location) => historySubject.onNext(location));

  const route = (pattern, opts, cb) => {
    const finalOpts = typeof opts === 'function' ? { stream: opts } : opts;
    const joinedPattern = joinPattern(prefix, pattern);
    const subRouter = typeof cb === 'function' && cb (
      createRouterObservable(history, joinedPattern)
    );
    if (subRouter) {
      const subRouterObservable = subRouter.asObservable();
      subRouters = [subRouter, ...subRouters];
    }

    const routeObservable = createRouteObservable(
      joinedPattern,
      finalOpts,
      history,
      historySubject.asObservable(),
      subRouter
    );

    routeSubject.onNext(routeObservable);

    return api;
  };

  const allRoutesObservable = routeSubject
    .flatMap(obs => obs)
    .replay();

  const asObservable = () => allRoutesObservable;

  const start = () => {
    const allDisposable = new Rx.CompositeDisposable();
    allDisposable.add(allRoutesObservable.connect());
    subRouters.forEach(router => {
      allDisposable.add(router.start());
    })
    return allDisposable;
  };

  const api = { route, asObservable, start };

  return api;
}

const createRouter = (create=createHistory) => {
  const history = create();
  return createRouterObservable(history);
};

export default createRouter;
