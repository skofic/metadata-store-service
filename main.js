'use strict';
const createRouter = require('@arangodb/foxx/router');
const router = createRouter();
module.context.use(router);   // mount at the service's root (currently /dict)

router.use('/term',    require('./routes/term'));     // term lookup + heuristic alias resolution
router.use('/enum',    require('./routes/enum'));     // enumeration traversal + membership check
router.use('/fields',  require('./routes/fields'));   // object descriptor property order
router.use('/resolve', require('./routes/resolve'));  // graph-aware alias resolution
router.use('/blob',    require('./routes/blob'));     // blob fetch by _key
