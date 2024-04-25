'use strict'
const querystring = require('querystring')
const express = require('express')

const config = require('../config')
const dms = require('../lib/dms')
const utils = require('../utils')
const { URL } = require('url')
const https = require("https")
const http = require("http")
const { callbackPromise } = require('nodemailer/lib/shared')
const logger = require('../utils/logger')
const { param } = require('express-validator')
const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');

const multer = require('multer'); // Modul untuk menangani upload file
const storage = multer.diskStorage({
  destination: '/var/lib/ckan/default/storage/uploads/user',  
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  },
});
const upload = multer({ storage: storage}); // Multer middleware for handling file uploads


module.exports = function () {
  const router = express.Router()
  const Model = new dms.DmsModel(config)

  // -----------------------------------------------
  // Redirects
 
  const xssSanitize = (value) => {
    const window = new JSDOM('').window;
    const DOMPurify = createDOMPurify(window);
    return DOMPurify.sanitize(value, { ALLOWED_TAGS: [] });
  }



  router.get('/dataset', (req, res) => {
    let destination = '/search'
    const query = querystring.stringify(req.query)
    if (query) {
      destination += `?${query}`
    }
    res.redirect(301, destination)
  })

  router.get('/dataset/:name', param(['name']).customSanitizer(xssSanitize),  async (req, res, next) => {
    // Identify owner org name
    let datapackage = await Model.getPackage(req.params.name)

    const destination = `/${datapackage.organization.name}/${datapackage.name}`
    res.redirect(301, destination)
  })

  router.get('/dataset/:name/resource/:id', param(['name','id']).customSanitizer(xssSanitize), async (req, res, next) => {
    // Identify owner org name
    let datapackage = await Model.getPackage(req.params.name)

    const resourceName = datapackage.resources
      .find(resource => resource.id === req.params.id)
      .name

    const destination = `/${datapackage.organization.name}/${datapackage.name}#resource-${resourceName.replace('.', '_')}`

    res.redirect(301, destination)
  })

  router.get('/organization/:owner', param(['owner']).customSanitizer(xssSanitize), (req, res) => {
    const destination = '/' + req.params.owner
    res.redirect(301, destination)
  })

  router.get('/group', (req, res) => {
    res.redirect(301, '/collections')
  })

  router.get('/group/:collection', param(['collection']).customSanitizer(xssSanitize), (req, res) => {
    const destination = '/collections/' + req.params.collection
    res.redirect(301, destination)
  })

  // End of redirects
  // -----------------------------------------------

  // Robots txt
  router.get('/robots.txt', (req, res) => {
    res.type('text/plain')
    res.send("User-agent: *\nAllow: /");
  });

  const verifyToken = (req, res, next) => {
    // Ambil token dari cookie
    const token = req.cookies.token;
  
    // Jika tidak ada token, kirim respons Unauthorized
    if (!token) {
      res.redirect('/login');
    }
  
    try {
      // Verifikasi token
      const jwtSecret = process.env.JWT_SECRET; // Pastikan kunci rahasia sesuai dengan yang digunakan saat membuat token
      const decoded = jwt.verify(token, jwtSecret);
  
      // Token valid, lanjutkan ke middleware berikutnya
      req.user = decoded; // Jika Anda ingin menggunakan informasi pengguna dari token, Anda dapat menyimpannya di req.user
      next();
    } catch (error) {
      // Tanggapi jika token tidak valid
      res.redirect('/login');
      // return res.status(401).json({ message: 'Unauthorized' });
    }
  }

  router.get('/', async (req, res) => {
    // If no CMS is enabled, show home page without posts
    res.render('home.html', {
      title: 'Home'
    })
  })

  router.get(config.get('WP_BLOG_PATH'), async (req, res) => {
    res.render('blog.html', {
      title: 'Home'
    })
  })

  router.get('/search', async (req, res, next) => {
    const result = await Model.search(req.query)
    // Pagination
    const from = req.query.from || 0
    const size = req.query.size || 10
    const total = result.count
    const totalPages = Math.ceil(total / size)
    const currentPage = parseInt(from, 10) / size + 1
    const pages = utils.pagination(currentPage, totalPages)

    res.render('search.html', {
      title: 'Search',
      result,
      query: req.query,
      totalPages,
      pages,
      currentPage
    })
  })

  router.get('/collections', async (req, res, next) => {
    const collections = await Model.getCollections()
    res.render('collections-home.html', {
      title: 'Dataset Collections',
      description: 'Catalogue of datasets for a particular project or team, or on a particular theme, or as a very simple way to help people find and search your own published datasets.',
      collections,
      slug: 'collections'
    })
  })

  router.get('/collections/:collectionName',
    param(['collectionName']).customSanitizer(xssSanitize), async (req, res) => {
    // Get collection details
    const name = req.params.collectionName
    const collection = await Model.getCollection(name)
    // Get datasets for this collection
    if (req.query.q) {
      req.query.q += ` groups:${name}`
    } else {
      req.query.q = `groups:${name}`
    }
    const result = await Model.search(req.query)
    // Pagination
    const from = req.query.from || 0
    const size = req.query.size || 10
    const total = result.count
    const totalPages = Math.ceil(total / size)
    const currentPage = parseInt(from, 10) / size + 1
    const pages = utils.pagination(currentPage, totalPages)
    res.render('collection.html', {
      title: collection.title, // needed because this is used in base.html
      item: collection,
      result,
      query: req.query,
      totalPages,
      pages,
      currentPage
    })
  })

  // Endpoint untuk menangani permintaan login
  router.post('/login', async (req, res) => {
    const { username, password } = req.body;
  
    try {
      // Coba login dengan endpoint /LoginMahasiswa
      const responseMahasiswa = await axios.post('https://api.ipb.ac.id/v1/Authentication/LoginMahasiswa', {
        username,
        password
      }, {
        headers: {
          'X-IPBAPI-TOKEN': 'Bearer 2ead4c81-023a-4419-9d97-c66061559ec9'
        }
      });
  
      // Jika berhasil, kirimkan respons dengan data yang diterima
      const payload = { mahasiswa: responseMahasiswa.data };
      const jwtSecret = process.env.JWT_SECRET;
      const expiresIn = 60 * 60 * 1;
      const token = jwt.sign(payload, jwtSecret, { expiresIn: expiresIn });
      const nama = responseMahasiswa.data.Nama; // Ambil nilai nama dan nim dari responseMahasiswa.data
      const nim = responseMahasiswa.data.nim;
      res.cookie('token', token, { httpOnly: true, maxAge: 3600 * 1000 });
      // res.json(responseMahasiswa.data);
      // res.json({ token, nama, nim });
      console.log('Data pengguna:', responseMahasiswa.data);
      res.redirect('/');
    } catch (error) {
      // Jika gagal login dengan /LoginMahasiswa, coba dengan /LoginDosen
      try {
        const responseDosen = await axios.post('https://api.ipb.ac.id/v1/Authentication/LoginDosen', {
          username,
          password
        }, {
          headers: {
            'X-IPBAPI-TOKEN': 'Bearer 2ead4c81-023a-4419-9d97-c66061559ec9'
          }
        });
  
        // Jika berhasil, kirimkan respons dengan data yang diterima
        const payload = { mahasiswa: responseDosen.data };
        const jwtSecret = process.env.JWT_SECRET;
        const expiresIn = 60 * 60 * 1;
        const token = jwt.sign(payload, jwtSecret, { expiresIn: expiresIn });
        const nama = responseDosen.data.Nama; // Ambil nilai nama dan nim dari responseMahasiswa.data
        const nip = responseDosen.data.nip;
        res.cookie('token', token, { httpOnly: true, maxAge: 3600 * 1000 });
      console.log('Data pengguna:', responseDosen.data);
      res.redirect('/');
      } catch (error) {
        if (error.response && error.response.status === 401) {
          // Unauthorized: username/password salah
          const errorMessage = error.response.data.error;
          res.render('auth/loginerror.html', { login_error: errorMessage });
          //res.status(401).send('Incorrect username or password.');
        } else {
          // Kesalahan lain yang tidak terduga
          console.error(error);
          res.status(500).send('Internal Server Error');
        }
      }
    }
  })
  
  



//router untuk ke halaman isi metadata
  router.get('/create', verifyToken, async (req, res) => {
    res.render('create.html', {
      title: 'Create'
    })
  })
  router.get('/createError', verifyToken, async (req, res) => {
    res.render('createError.html', {
      title: 'Dataset Gagal Ditambahkan'
    })
  })
//router untuk ke halaman upload file dataset
  router.get('/upload', verifyToken, async (req, res) => {
    res.render('upload.html', {
      title: 'Upload Dataset'
    })
  })

  //router untuk ke halaman notifikasi file berhasil diupload
  router.get('/uploaded', verifyToken, async (req, res) => {
    res.render('successUpload.html', {
      title: 'File Uploaded'
    })
  })

  // Tampilkan halaman login
  router.get('/login', async (req, res) => {
    // Cek apakah pengguna sudah login
    if (req.cookies.token) {
      // Pengguna sudah login, arahkan ke halaman home
      res.redirect('/');
    } else {
      // Pengguna belum login, tampilkan halaman login
      res.render('auth/login.html', {
        title: 'Login'
      });
    }
  })
  
  router.get('/logout', (req, res) => {
    // Hapus cookie token dengan mengatur ulang nilainya dan menetapkan masa berlaku yang telah berlalu
    res.clearCookie('token');
    // Redirect pengguna ke halaman lain setelah logout
    res.redirect('/');
  })

  // Tampilkan halaman login
  router.get('/createOrg', verifyToken, async (req, res) => {
    res.render('createOrg.html', {
      title: 'Buat Organisasi'
    })
  })

  // Tampilkan halaman login
  router.get('/orgCreated', verifyToken, async (req, res) => {
    res.render('organization-created.html', {
      title: 'Organisasi dibuat'
    })
  })
  router.get('/orgError', verifyToken, async (req, res) => {
    res.render('organization-error.html', {
      title: 'Organisasi gagal dibuat'
    })
  })

  router.get('/:owner/:name', param(['owner', 'name']).customSanitizer(xssSanitize),
    async (req, res, next) => {
    let datapackage = res.locals.datapackage || null
    datapackage = await prepareDataPackageForRender(req.params.name, datapackage)

    const profile = await Model.getProfile(req.params.owner)
    res.render('showcase.html', {
      title: req.params.owner + ' | ' + req.params.name,
      dataset: datapackage,
      owner: {
        name: profile.name,
        title: profile.title,
        description: utils.processMarkdown.render(profile.description || ''),
        avatar: profile.image_display_url || profile.image_url
      },
      thisPageFullUrl: '//' + req.get('host') + req.originalUrl,
      dpId: JSON.stringify(datapackage).replace(/'/g, "&#x27;"), // keep for backwards compat?
      jsonld: JSON.stringify(utils.packageJsonldGenerate(datapackage))
    })
  })

  router.get('/:owner/:name/datapackage.json',
      param(['owner', 'name']).customSanitizer(xssSanitize), async (req, res, next) => {
    let datapackage = res.locals.datapackage || null
    datapackage = await prepareDataPackageForRender(req.params.name, datapackage)

    res.setHeader('Content-Type', 'application/json')
    res.status(200)
    res.end(JSON.stringify(datapackage))
  })

  async function prepareDataPackageForRender(name, datapackage) {
    if (!datapackage) {
      datapackage = await Model.getPackage(name)
    }

    // Prepare datapackage for display, eg, process markdown, convert values to
    // human-readable format etc.:
    datapackage = utils.processDataPackage(datapackage)

    // Prepare resources for display (preview):
    datapackage = utils.prepareResourcesForDisplay(datapackage)

    // Since "datapackage-views-js" library renders views according to
    // descriptor's "views" property, we need to generate view objects.
    // Note that we have "views" per resources so here we will consolidate them.
    datapackage = utils.prepareViews(datapackage)

    // Data Explorer used a slightly different spec than "datapackage-views-js":
    datapackage = utils.prepareDataExplorers(datapackage)

    // Prep text views - load first 10Kb of a file to 'content' attribut which
    // we can render as is in the template.
    datapackage.displayResources = await Promise.all(datapackage.displayResources.map(async item => {
      if (item.resource.views) {
        await Promise.all(item.resource.views.map(async (view, index) => {
          if (view && view.specType === 'text' && item.resource.path) {
            item.resource.views[index].content = await fetchTextContent(item.resource.path)
          }
        }))
      }
      return item
    }))

    return datapackage
  }


  function fetchTextContent(url) {
    let newURL = new URL(url)
    let protocol = https
    return new Promise((resolve, reject) => {
      if (newURL.protocol == 'http:') {
        protocol = http
      }
      protocol.get(newURL, (res, error) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          https.get(res.headers.location, (res, error) => {
            let buff = new Buffer(0)
            res.on('data', (chunk) => {
              buff = Buffer.concat([buff, chunk])
              if (buff.length > 10240) {
                res.destroy()
                resolve(buff.toString())
              }
            })
            res.on('end', () => {
              resolve(buff.toString())
            })
          }).on('error', (e) => {
            logger.error(e)
          })
        } else {
          let buff = new Buffer(0)
          res.on('data', (chunk) => {
            buff = Buffer.concat([buff, chunk])
            if (buff.length > 10240) {
              res.destroy()
              resolve(buff.toString())
            }
          })
          res.on('end', () => {
            resolve(buff.toString())
          })
        }
      }).on('error', (e) => {
        logger.error(e)
      })
    })
  }

  router.get('/organization', async (req, res, next) => {
    const collections = await Model.getOrganizations()
    res.render('collections-home.html', {
      title: 'Organisasi',
      description: 'Organisasi untuk membuat, mengelola, dan mempublikasikan data.',
      collections,
      slug: 'organization'
    })
  })

  // MUST come last in order to catch all the publisher pages
  router.get('/:owner', param(['owner']).customSanitizer(xssSanitize), async (req, res, next) => {
    // Get owner details
    const owner = req.params.owner
    const profile = await Model.getProfile(owner)
    // if not a valid profile, send them on the way
    if (!profile.created) {
      return res.status(404).render('404.html', {
        message: `PAGE NOT FOUND: ${owner}`,
        status: 404
      })
    }
    const created = new Date(profile.created)
    const joinYear = created.getUTCFullYear()
    const joinMonth = created.toLocaleString('en-us', { month: "long" })
    // Get datasets for this owner
    if (req.query.q) {
      req.query.q += ` organization:${owner}`
    } else {
      req.query.q = `organization:${owner}`
    }
    const result = await Model.search(req.query)
    // Pagination
    const from = req.query.from || 0
    const size = req.query.size || 10
    const total = result.count
    const totalPages = Math.ceil(total / size)
    const currentPage = parseInt(from, 10) / size + 1
    const pages = utils.pagination(currentPage, totalPages)

    res.render('owner.html', {
      title: profile.title,
      owner: {
        name: profile.name,
        title: profile.title,
        description: utils.processMarkdown.render(profile.description || ''),
        avatar: profile.image_display_url || profile.image_url,
        joinDate: joinMonth + ' ' + joinYear,
      },
      result,
      query: req.query,
      totalPages,
      pages,
      currentPage
    })
  })

  //Urai data formulir
  router.use(express.urlencoded({ extended: false }));
  //Urai data dengan json
  router.use(express.json());
  // Router untuk endpoint /create-dataset dengan middleware verifikasi token
  router.post('/create-dataset', verifyToken, (req, res) => {
    // Panggil fungsi createDataset
    Model.createDataset(req, res);
  })
  
  // Rute untuk mengunggah dataset
router.post('/upload-dataset', upload.single('datasetFile'), async (req, res) => {
  // Dapatkan file dataset dari req.file
  console.log('Path File:', req.file.path);
  Model.createResource(req, res)
})

//Buat Router untuk fungsi membuat organisasi
router.post('/create-organization', (req, res) => {
  //Panggil fungsi createDataset
  Model.createOrganization(req, res)
})

  return router
}
