'use strict';
const createRouter = require('@arangodb/foxx/router');
const router = createRouter();
module.context.use(router);   // mount at the service's root (currently /dict)

router.use('/term',   require('./routes/term'));     // term lookup + alias resolution
router.use('/enum',   require('./routes/enum'));     // enumeration traversal
router.use('/fields', require('./routes/fields'));   // field ordering via _predicate_field-of
