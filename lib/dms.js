'use strict'

const { resolve, URL } = require('url')
const fetch = require('node-fetch')
const utils = require('../utils')
const querystring = require("querystring");
const logger = require('../utils/logger')

const CKAN = require('ckan');
const { title } = require('process');
const API_KEY = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJqdGkiOiJ5VzBjY0pvaEJ1TkxsWEVheVZFdF9YWUIyWUx3M3Q3ZGNTNko1SWxTTEE4IiwiaWF0IjoxNjk5MjczMTMyfQ.-X9R4bvtue2dmdzUIaJIBn6gplWNfjjS694-saoOygs'

class DmsModel {
  constructor(config) {
    this.config = config
    this.api = config.get('INTERNAL_API_URL') || config.get('API_URL')
  }

  //Fungsi membuat dataset baru
  async createDataset(req, res) {
    // Membuat objek CKAN API
    const client = new CKAN.Client('http://127.0.0.1', API_KEY);
  
    // Ubah informasi pada dataset ke bentuk yang sesuai
    const datasetName = req.body.title;
  
    console.log(typeof(datasetName));
  
    // Panggil package_create API-CKAN dengan data_dict sebagai parameter
    client.action('dataset_create', {
      name: req.body.title,
      title: req.body.title,
      notes: req.body.description,
      license_id: req.body.license,
      owner_org: req.body.owner
    }, async function(err, result) {
      if (err) {
        console.error('Error creating dataset:', err);
        return res.status(500).json({ success: false, error: 'Dataset gagal ditambahkan' });
      } else {
        console.log('Dataset created:', result);
        
         // Simpan data metadata dalam sesi atau penyimpanan sesaat
        const datasetMetadata = {
          package_id: req.body.title,
          name: req.body.title,
          description: req.body.description,
          format: req.body.format,
    };
    req.session.metadata = datasetMetadata;

        // Berhasil: Kirim respons ke klien
        return res.redirect('/upload'); // Gantilah '/upload' dengan rute yang sesuai

      }
    });
  }

  //Fungsi membuat organisasi baru
  async createOrganization(req, res) {
    // Membuat objek CKAN API
    const client = new CKAN.Client('http://127.0.0.1', API_KEY);
  
  
    // Panggil organization_create API-CKAN dengan data_dict sebagai parameter
    client.action('organization_create', {
      name: req.body.organizationName,
      title: req.body.organizationTitle,
      description: req.body.organizationDescription
    }, async function(err, result) {
      if (err) {
        console.error('Error creating organization:', err);
        return res.redirect('/orgError'); 
      } else {
        console.log('Organization created:', result);
        return res.redirect('/orgCreated'); 
      }
    });
  }



  // Upload package
  async createResource(req, res) {
    const upload = req.file.path;
    const datasetMetadata = req.session.metadata; // Misalnya, jika Anda menggunakan Express.js
    console.log('Dataset Metadata:', datasetMetadata);
    // Pastikan Anda memiliki data metadata yang sesuai untuk resource yang ingin Anda unggah
    const resourceMetadata = {
      package_id: datasetMetadata.package_id,
      name: req.file.originalname,
      description: datasetMetadata.description,
      format: req.file.originalname.split('.').pop(),
      upload: '@' + upload,// Format benar untuk mengunggah file
      url:req.file.originalname,
      url_type:'upload'
    };
    
  
    // Mengambil file dataset dari req.file
    const datasetFile = req.file.path;
    console.log('Dataset File:', datasetFile);
    // Lakukan logika untuk mengunggah file dataset ke CKAN menggunakan API CKAN
    const CKAN = require('ckan');
    const client = new CKAN.Client('http://127.0.0.1', API_KEY);
  
    // Mengatur data metadata dalam penggunaan resource_create
    resourceMetadata.upload = datasetFile; // Menggunakan datasetFile sebagai file yang diunggah
  
    // Gunakan metode `resource_create` untuk mengunggah file dataset
    client.action('resource_create', resourceMetadata, function(err, result) {
      if (err) {
        console.error('Error uploading dataset:', err);
        return res.status(500).json({ success: false, error: 'Gagal mengunggah dataset' });
      } else {
        console.log('Dataset uploaded successfully:', result);
  
        // Berhasil: Kirim respons ke klien
        return res.redirect('/uploaded');
      }
    });

      
  }


  async getJsonResponse(params, action) {

    let query = querystring.stringify(params)

    let url = new URL(resolve(this.api, action + '?' + query))
    let response = await fetch(url, { 
      headers: { 'User-Agent': 'frontend-v2/latest (internal API call from frontend app)' }
    })
    
    if (response.status !== 200) {
      throw response
    }

    try {
      response = await response.json()
    }
    catch(err) {
      logger.info("Response", response)
      logger.error("Error", err)
      response = await response.json()
    }

    return response
  }

  async search(query, context) {
    // TODO: context can have API Key so we need to pass it through
    const action = 'package_search'
    const params = utils.convertToCkanSearchQuery(query)

    const response = await this.getJsonResponse(params, action)

    // Convert CKAN descriptor => data package
    response.result.results = response.result.results.map(pkg => {
      return utils.ckanToDataPackage(pkg)
    })
    return response.result
  }

  async getPackage(name, includeViewsAndSchema = true) {
    const action = 'package_show'
    const params = {
      id: name
    }
    const response = await this.getJsonResponse(params, action)

    const datapackage = utils.ckanToDataPackage(response.result)

    if (includeViewsAndSchema) {
      datapackage.resources = await Promise.all(datapackage.resources.map(async resource => {
        return {
          views: await this.getResourceViews(resource.id), // Fetch views for the resources
          schema: resource.datastore_active && !resource.schema
            ? await this.getResourceSchema(resource.id) // Get resource schema from datastore data dictionary
            : undefined,
          ...resource
        }
      }))
    }

    return datapackage
  }

  async getResource(packageName, resourceName) {
    const datapackage = await this.getPackage(packageName, false)
    datapackage.resources = datapackage.resources.filter(item => item.name === resourceName)

    // Redirect to 404 page if resource don't exist.
    if (datapackage.resources.length == 0) {
      var err = new Error();
      err.status = 404;
      err.statusText = 'RESOURCE NOT FOUND'
      err.text = () => {
        return 'Resource not found.'
      }
      throw (err)
    }

    datapackage.resources = await Promise.all(datapackage.resources.map(async resource => {
      return {
        views: await this.getResourceViews(resource.id), // Fetch views for the resources
        schema: resource.datastore_active && !resource.schema
          ? await this.getResourceSchema(resource.id) // Get resource schema from datastore data dictionary
          : undefined,
        ...resource
      }
    }))

    return datapackage
  }

  async getResourceSchema(resourceId) {
    try {
      const action = 'datastore_search'
      const params = {
        'resource_id' : resourceId,
        'limit': 0 // as we only need field info, not actual records
      }
      let response = await this.getJsonResponse(params, action)

      const fields = response.result.fields
        .map(field => utils.dataStoreDataDictionaryToTableSchema(field))
        .filter(field => field)

      return {fields}
    } catch (e) {
      const details = e.text ? await e.text() : e.message
      logger.warn({
        message: `Failed to getResourceSchema | ${resourceId} | ${details}`
      })
      return {}
    }
  }

  async getResourceViews(resourceId) {
    try{
      const action = 'resource_view_list'
      const params = {
        id: resourceId
      }
      const response = await this.getJsonResponse(params, action)
      const views = response.result
      for (let i = 0; i < views.length; i++) {
        views[i] = utils.ckanViewToDataPackageView(views[i])
      }
      return views
    } catch (e) {
      const details = e.text ? await e.text() : e.message
      logger.warn({
        message: `Failed to getResourceViews | ${resourceId} | ${details}`
      })
      return []
    }
  }

  async getOrganizations(query = {}) {
    const action = 'organization_list'
    const params = Object.assign(
      {
         all_fields: true,
         sort: 'package_count'
      },
      query
    )
    const response = await this.getJsonResponse(params, action)
    // Convert CKAN group descriptor into "standard" collection descriptor
    const organizations = response.result.map(org => {
      return utils.convertToStandardCollection(org)
    })
    return organizations
  }

  async getProfile(owner) {
    try {
      const action = 'organization_show'
      const params = {
        id: owner,
        include_users: false
      }
      const response = await this.getJsonResponse(params, action)
      return response.result
    } catch (e) {
      const details = e.text ? await e.text() : e.message
      logger.warn({
        message: `Failed to getProfile | ${owner} | ${details}`
      })
      return {}
    }
  }

  async getCollections(params) {
    const action = 'group_list'
    params = params ? params : {
      all_fields: true
    }
    const response = await this.getJsonResponse(params, action)
    // Convert CKAN group descriptor into "standard" collection descriptor
    const collections = response.result.map(collection => {
      return utils.convertToStandardCollection(collection)
    })
    return collections
  }

  async getCollection(collection) {
    const action = 'group_show'
    const params = {
      id: collection
    }
    const response = await this.getJsonResponse(params, action)
    return utils.convertToStandardCollection(response.result)
  }
}

module.exports.DmsModel = DmsModel
